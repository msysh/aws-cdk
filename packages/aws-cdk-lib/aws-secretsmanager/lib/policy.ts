import { Construct } from 'constructs';
import { ISecret } from './secret';
import { CfnResourcePolicy } from './secretsmanager.generated';
import * as iam from '../../aws-iam';
import { Resource } from '../../core';
import { addConstructMetadata } from '../../core/lib/metadata-resource';
import { propertyInjectable } from '../../core/lib/prop-injectable';

/**
 * Construction properties for a ResourcePolicy
 */
export interface ResourcePolicyProps {
  /**
   * The secret to attach a resource-based permissions policy
   */
  readonly secret: ISecret;
}

/**
 * Resource Policy for SecretsManager Secrets
 *
 * Policies define the operations that are allowed on this resource.
 *
 * You almost never need to define this construct directly.
 *
 * All AWS resources that support resource policies have a method called
 * `addToResourcePolicy()`, which will automatically create a new resource
 * policy if one doesn't exist yet, otherwise it will add to the existing
 * policy.
 *
 * Prefer to use `addToResourcePolicy()` instead.
 */
@propertyInjectable
export class ResourcePolicy extends Resource {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string = 'aws-cdk-lib.aws-secretsmanager.ResourcePolicy';
  /**
   * The IAM policy document for this policy.
   */
  public readonly document = new iam.PolicyDocument();

  constructor(scope: Construct, id: string, props: ResourcePolicyProps) {
    super(scope, id);
    // Enhanced CDK Analytics Telemetry
    addConstructMetadata(this, props);

    new CfnResourcePolicy(this, 'Resource', {
      resourcePolicy: this.document,
      secretId: props.secret.secretArn,
    });
  }
}
