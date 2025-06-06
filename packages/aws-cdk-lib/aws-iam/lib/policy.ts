import { Construct } from 'constructs';
import { IGroup } from './group';
import { CfnPolicy } from './iam.generated';
import { PolicyDocument } from './policy-document';
import { PolicyStatement } from './policy-statement';
import { AddToPrincipalPolicyResult, IGrantable, IPrincipal, PrincipalPolicyFragment } from './principals';
import { generatePolicyName, undefinedIfEmpty } from './private/util';
import { IRole } from './role';
import { IUser } from './user';
import { IResource, Lazy, Resource } from '../../core';
import { addConstructMetadata, MethodMetadata } from '../../core/lib/metadata-resource';
import { propertyInjectable } from '../../core/lib/prop-injectable';

/**
 * Represents an IAM Policy
 *
 * @see https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_manage.html
 */
export interface IPolicy extends IResource {
  /**
   * The name of this policy.
   *
   * @attribute
   */
  readonly policyName: string;
}

/**
 * Properties for defining an IAM inline policy document
 */
export interface PolicyProps {
  /**
   * The name of the policy. If you specify multiple policies for an entity,
   * specify unique names. For example, if you specify a list of policies for
   * an IAM role, each policy must have a unique name.
   *
   * @default - Uses the logical ID of the policy resource, which is ensured
   * to be unique within the stack.
   */
  readonly policyName?: string;

  /**
   * Users to attach this policy to.
   * You can also use `attachToUser(user)` to attach this policy to a user.
   *
   * @default - No users.
   */
  readonly users?: IUser[];

  /**
   * Roles to attach this policy to.
   * You can also use `attachToRole(role)` to attach this policy to a role.
   *
   * @default - No roles.
   */
  readonly roles?: IRole[];

  /**
   * Groups to attach this policy to.
   * You can also use `attachToGroup(group)` to attach this policy to a group.
   *
   * @default - No groups.
   */
  readonly groups?: IGroup[];

  /**
   * Initial set of permissions to add to this policy document.
   * You can also use `addStatements(...statement)` to add permissions later.
   *
   * @default - No statements.
   */
  readonly statements?: PolicyStatement[];

  /**
   * Force creation of an `AWS::IAM::Policy`
   *
   * Unless set to `true`, this `Policy` construct will not materialize to an
   * `AWS::IAM::Policy` CloudFormation resource in case it would have no effect
   * (for example, if it remains unattached to an IAM identity or if it has no
   * statements). This is generally desired behavior, since it prevents
   * creating invalid--and hence undeployable--CloudFormation templates.
   *
   * In cases where you know the policy must be created and it is actually
   * an error if no statements have been added to it or it remains unattached to
   * an IAM identity, you can set this to `true`.
   *
   * @default false
   */
  readonly force?: boolean;

  /**
   * Initial PolicyDocument to use for this Policy. If omited, any
   * `PolicyStatement` provided in the `statements` property will be applied
   * against the empty default `PolicyDocument`.
   *
   * @default - An empty policy.
   */
  readonly document?: PolicyDocument;
}

/**
 * The AWS::IAM::Policy resource associates an [inline](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html#inline)
 * IAM policy with IAM users, roles, or groups. For more information about IAM policies, see
 * [Overview of IAM Policies](http://docs.aws.amazon.com/IAM/latest/UserGuide/policies_overview.html)
 * in the IAM User Guide guide.
 */
@propertyInjectable
export class Policy extends Resource implements IPolicy, IGrantable {
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string = 'aws-cdk-lib.aws-iam.Policy';

  /**
   * Import a policy in this app based on its name
   */
  public static fromPolicyName(scope: Construct, id: string, policyName: string): IPolicy {
    class Import extends Resource implements IPolicy {
      public readonly policyName = policyName;
    }

    return new Import(scope, id);
  }

  /**
   * The policy document.
   */
  public readonly document = new PolicyDocument();

  public readonly grantPrincipal: IPrincipal;

  private readonly _policyName: string;
  private readonly roles = new Array<IRole>();
  private readonly users = new Array<IUser>();
  private readonly groups = new Array<IGroup>();
  private readonly force: boolean;
  private referenceTaken = false;

  constructor(scope: Construct, id: string, props: PolicyProps = {}) {
    super(scope, id, {
      physicalName: props.policyName ||
        // generatePolicyName will take the last 128 characters of the logical id since
        // policy names are limited to 128. the last 8 chars are a stack-unique hash, so
        // that shouod be sufficient to ensure uniqueness within a principal.
        Lazy.string({ produce: () => generatePolicyName(scope, resource.logicalId) }),
    });
    // Enhanced CDK Analytics Telemetry
    addConstructMetadata(this, props);

    const self = this;

    class CfnPolicyConditional extends CfnPolicy {
      /**
       * This function returns `true` if the CFN resource should be included in
       * the cloudformation template unless `force` is `true`, if the policy
       * document is empty, the resource will not be included.
       */
      protected shouldSynthesize() {
        return self.force || self.referenceTaken || (!self.document.isEmpty && self.isAttached);
      }
    }

    if (props.document) {
      this.document = props.document;
    }

    const resource = new CfnPolicyConditional(this, 'Resource', {
      policyDocument: this.document,
      policyName: this.physicalName,
      roles: undefinedIfEmpty(() => this.roles.map(r => r.roleName)),
      users: undefinedIfEmpty(() => this.users.map(u => u.userName)),
      groups: undefinedIfEmpty(() => this.groups.map(g => g.groupName)),
    });

    this._policyName = this.physicalName!;
    this.force = props.force ?? false;

    if (props.users) {
      props.users.forEach(u => this.attachToUser(u));
    }

    if (props.groups) {
      props.groups.forEach(g => this.attachToGroup(g));
    }

    if (props.roles) {
      props.roles.forEach(r => this.attachToRole(r));
    }

    if (props.statements) {
      props.statements.forEach(p => this.addStatements(p));
    }

    this.grantPrincipal = new PolicyGrantPrincipal(this);

    this.node.addValidation({ validate: () => this.validatePolicy() });
  }

  /**
   * Adds a statement to the policy document.
   */
  @MethodMetadata()
  public addStatements(...statement: PolicyStatement[]) {
    this.document.addStatements(...statement);
  }

  /**
   * Attaches this policy to a user.
   */
  @MethodMetadata()
  public attachToUser(user: IUser) {
    if (this.users.find(u => u.userArn === user.userArn)) { return; }
    this.users.push(user);
    user.attachInlinePolicy(this);
  }

  /**
   * Attaches this policy to a role.
   */
  @MethodMetadata()
  public attachToRole(role: IRole) {
    if (this.roles.find(r => r.roleArn === role.roleArn)) { return; }
    this.roles.push(role);
    role.attachInlinePolicy(this);
  }

  /**
   * Attaches this policy to a group.
   */
  @MethodMetadata()
  public attachToGroup(group: IGroup) {
    if (this.groups.find(g => g.groupArn === group.groupArn)) { return; }
    this.groups.push(group);
    group.attachInlinePolicy(this);
  }

  /**
   * The name of this policy.
   *
   * @attribute
   */
  public get policyName(): string {
    this.referenceTaken = true;
    return this._policyName;
  }

  private validatePolicy(): string[] {
    const result = new Array<string>();

    // validate that the policy document is not empty
    if (this.document.isEmpty) {
      if (this.force) {
        result.push('Policy created with force=true is empty. You must add statements to the policy');
      }
      if (!this.force && this.referenceTaken) {
        result.push('This Policy has been referenced by a resource, so it must contain at least one statement.');
      }
    }

    // validate that the policy is attached to at least one principal (role, user or group).
    if (!this.isAttached) {
      if (this.force) {
        result.push('Policy created with force=true must be attached to at least one principal: user, group or role');
      }
      if (!this.force && this.referenceTaken) {
        result.push('This Policy has been referenced by a resource, so it must be attached to at least one user, group or role.');
      }
    }

    result.push(...this.document.validateForIdentityPolicy());

    return result;
  }

  /**
   * Whether the policy resource has been attached to any identity
   */
  private get isAttached() {
    return this.groups.length + this.users.length + this.roles.length > 0;
  }
}

class PolicyGrantPrincipal implements IPrincipal {
  public readonly assumeRoleAction = 'sts:AssumeRole';
  public readonly grantPrincipal: IPrincipal;
  public readonly principalAccount?: string;

  constructor(private _policy: Policy) {
    this.grantPrincipal = this;
    this.principalAccount = _policy.env.account;
  }

  public get policyFragment(): PrincipalPolicyFragment {
    // This property is referenced to add policy statements as a resource-based policy.
    // We should fail because a policy cannot be used as a principal of a policy document.
    // cf. https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_principal.html#Principal_specifying
    throw new Error(`Cannot use a Policy '${this._policy.node.path}' as the 'Principal' or 'NotPrincipal' in an IAM Policy`);
  }

  public addToPolicy(statement: PolicyStatement): boolean {
    return this.addToPrincipalPolicy(statement).statementAdded;
  }

  public addToPrincipalPolicy(statement: PolicyStatement): AddToPrincipalPolicyResult {
    this._policy.addStatements(statement);
    return { statementAdded: true, policyDependable: this._policy };
  }
}
