import { Construct, IConstruct, IDependable, Node, MetadataOptions } from 'constructs';
import { Architecture } from './architecture';
import { Function as LambdaFunction, FunctionProps, EnvironmentOptions } from './function';
import { FunctionBase } from './function-base';
import { Version } from './lambda-version';
import { ILayerVersion } from './layers';
import { Permission } from './permission';
import { Runtime } from './runtime';
import * as ec2 from '../../aws-ec2';
import * as iam from '../../aws-iam';
import * as logs from '../../aws-logs';
import * as cdk from '../../core';
import { addConstructMetadata, MethodMetadata } from '../../core/lib/metadata-resource';
import { propertyInjectable } from '../../core/lib/prop-injectable';

/**
 * Properties for a newly created singleton Lambda
 */
export interface SingletonFunctionProps extends FunctionProps {
  /**
   * A unique identifier to identify this lambda
   *
   * The identifier should be unique across all custom resource providers.
   * We recommend generating a UUID per provider.
   */
  readonly uuid: string;

  /**
   * A descriptive name for the purpose of this Lambda.
   *
   * If the Lambda does not have a physical name, this string will be
   * reflected its generated name. The combination of lambdaPurpose
   * and uuid must be unique.
   *
   * @default SingletonLambda
   */
  readonly lambdaPurpose?: string;
}

/**
 * A Lambda that will only ever be added to a stack once.
 *
 * This construct is a way to guarantee that the lambda function will be guaranteed to be part of the stack,
 * once and only once, irrespective of how many times the construct is declared to be part of the stack.
 * This is guaranteed as long as the `uuid` property and the optional `lambdaPurpose` property stay the same
 * whenever they're declared into the stack.
 *
 * @resource AWS::Lambda::Function
 */
@propertyInjectable
export class SingletonFunction extends FunctionBase {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string = 'aws-cdk-lib.aws-lambda.SingletonFunction';
  public readonly grantPrincipal: iam.IPrincipal;
  public readonly functionName: string;
  public readonly functionArn: string;
  public readonly role?: iam.IRole;
  public readonly permissionsNode: Node;
  public readonly architecture: Architecture;

  /**
   * The runtime environment for the Lambda function.
   */
  public readonly runtime: Runtime;

  /**
   * The name of the singleton function. It acts as a unique ID within its CDK stack.
   * */
  public readonly constructName: string;

  protected readonly canCreatePermissions: boolean;
  private lambdaFunction: LambdaFunction;

  constructor(scope: Construct, id: string, props: SingletonFunctionProps) {
    super(scope, id);
    // Enhanced CDK Analytics Telemetry
    addConstructMetadata(this, props);

    this.constructName = (props.lambdaPurpose || 'SingletonLambda') + slugify(props.uuid);
    this.lambdaFunction = this.ensureLambda(props);
    this.permissionsNode = this.lambdaFunction.node;
    this.architecture = this.lambdaFunction.architecture;

    this.functionArn = this.lambdaFunction.functionArn;
    this.functionName = this.lambdaFunction.functionName;
    this.role = this.lambdaFunction.role;
    this.runtime = this.lambdaFunction.runtime;
    this.grantPrincipal = this.lambdaFunction.grantPrincipal;

    this.canCreatePermissions = true; // Doesn't matter, addPermission is overridden anyway
  }

  /**
   * @inheritdoc
   */
  public get isBoundToVpc(): boolean {
    return this.lambdaFunction.isBoundToVpc;
  }

  /**
   * @inheritdoc
   */
  public get connections(): ec2.Connections {
    return this.lambdaFunction.connections;
  }

  /**
   * The LogGroup where the Lambda function's logs are made available.
   *
   * If either `logRetention` is set or this property is called, a CloudFormation custom resource is added to the stack that
   * pre-creates the log group as part of the stack deployment, if it already doesn't exist, and sets the correct log retention
   * period (never expire, by default).
   *
   * Further, if the log group already exists and the `logRetention` is not set, the custom resource will reset the log retention
   * to never expire even if it was configured with a different value.
   */
  public get logGroup(): logs.ILogGroup {
    return this.lambdaFunction.logGroup;
  }

  /**
   * Returns a `lambda.Version` which represents the current version of this
   * singleton Lambda function. A new version will be created every time the
   * function's configuration changes.
   *
   * You can specify options for this version using the `currentVersionOptions`
   * prop when initializing the `lambda.SingletonFunction`.
   */
  public get currentVersion(): Version {
    return this.lambdaFunction.currentVersion;
  }

  public get resourceArnsForGrantInvoke() {
    return [this.functionArn, `${this.functionArn}:*`];
  }

  /**
   * Adds an environment variable to this Lambda function.
   * If this is a ref to a Lambda function, this operation results in a no-op.
   * @param key The environment variable key.
   * @param value The environment variable's value.
   * @param options Environment variable options.
   */
  @MethodMetadata()
  public addEnvironment(key: string, value: string, options?: EnvironmentOptions) {
    return this.lambdaFunction.addEnvironment(key, value, options);
  }

  /**
   * Adds one or more Lambda Layers to this Lambda function.
   *
   * @param layers the layers to be added.
   *
   * @throws if there are already 5 layers on this function, or the layer is incompatible with this function's runtime.
   */
  @MethodMetadata()
  public addLayers(...layers: ILayerVersion[]) {
    return this.lambdaFunction.addLayers(...layers);
  }

  @MethodMetadata()
  public addPermission(name: string, permission: Permission) {
    return this.lambdaFunction.addPermission(name, permission);
  }

  /**
   * Using node.addDependency() does not work on this method as the underlying lambda function is modeled
   * as a singleton across the stack. Use this method instead to declare dependencies.
   */
  @MethodMetadata()
  public addDependency(...up: IDependable[]) {
    this.lambdaFunction.node.addDependency(...up);
  }

  /**
   * Use this method to write to the construct tree.
   * The metadata entries are written to the Cloud Assembly Manifest if the `treeMetadata` property is specified in the props of the App that contains this Construct.
   */
  @MethodMetadata()
  public addMetadata(type: string, data: any, options?: MetadataOptions) {
    this.lambdaFunction.node.addMetadata(type, data, options);
  }

  /**
   * The SingletonFunction construct cannot be added as a dependency of another construct using
   * node.addDependency(). Use this method instead to declare this as a dependency of another construct.
   */
  @MethodMetadata()
  public dependOn(down: IConstruct) {
    down.node.addDependency(this.lambdaFunction);
  }

  /** @internal */
  public _checkEdgeCompatibility() {
    return this.lambdaFunction._checkEdgeCompatibility();
  }

  /**
   * Returns the construct tree node that corresponds to the lambda function.
   * @internal
   */
  protected _functionNode(): Node {
    return this.lambdaFunction.node;
  }

  private ensureLambda(props: SingletonFunctionProps): LambdaFunction {
    const existing = cdk.Stack.of(this).node.tryFindChild(this.constructName);
    if (existing) {
      // Just assume this is true
      return existing as LambdaFunction;
    }

    return new LambdaFunction(cdk.Stack.of(this), this.constructName, props);
  }
}

function slugify(x: string): string {
  return x.replace(/[^a-zA-Z0-9]/g, '');
}
