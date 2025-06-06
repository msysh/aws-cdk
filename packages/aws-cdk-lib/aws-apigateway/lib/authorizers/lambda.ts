import { Construct } from 'constructs';
import { IdentitySource } from './identity-source';
import * as iam from '../../../aws-iam';
import * as lambda from '../../../aws-lambda';
import { Arn, ArnFormat, Duration, FeatureFlags, Lazy, Names, Stack } from '../../../core';
import { ValidationError } from '../../../core/lib/errors';
import { addConstructMetadata } from '../../../core/lib/metadata-resource';
import { propertyInjectable } from '../../../core/lib/prop-injectable';
import { APIGATEWAY_AUTHORIZER_CHANGE_DEPLOYMENT_LOGICAL_ID } from '../../../cx-api';
import { CfnAuthorizer, CfnAuthorizerProps } from '../apigateway.generated';
import { Authorizer, IAuthorizer } from '../authorizer';
import { IRestApi } from '../restapi';

/**
 * Base properties for all lambda authorizers
 */
export interface LambdaAuthorizerProps {
  /**
   * An optional human friendly name for the authorizer. Note that, this is not the primary identifier of the authorizer.
   *
   * @default - the unique construct ID
   */
  readonly authorizerName?: string;

  /**
   * The handler for the authorizer lambda function.
   *
   * The handler must follow a very specific protocol on the input it receives
   * and the output it needs to produce.  API Gateway has documented the
   * handler's [input specification](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-lambda-authorizer-input.html)
   * and [output specification](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-lambda-authorizer-output.html).
   */
  readonly handler: lambda.IFunction;

  /**
   * How long APIGateway should cache the results. Max 1 hour.
   * Disable caching by setting this to 0.
   *
   * @default - Duration.minutes(5)
   */
  readonly resultsCacheTtl?: Duration;

  /**
   * An optional IAM role for APIGateway to assume before calling the Lambda-based authorizer. The IAM role must be
   * assumable by 'apigateway.amazonaws.com'.
   *
   * @default - A resource policy is added to the Lambda function allowing apigateway.amazonaws.com to invoke the function.
   */
  readonly assumeRole?: iam.IRole;
}

abstract class LambdaAuthorizer extends Authorizer implements IAuthorizer {
  /**
   * The id of the authorizer.
   * @attribute
   */
  public abstract override readonly authorizerId: string;

  /**
   * The ARN of the authorizer to be used in permission policies, such as IAM and resource-based grants.
   */
  public abstract readonly authorizerArn: string;

  /**
   * The Lambda function handler that this authorizer uses.
   */
  protected readonly handler: lambda.IFunction;

  /**
   * The IAM role that the API Gateway service assumes while invoking the Lambda function.
   */
  protected readonly role?: iam.IRole;

  protected restApiId?: string;

  protected abstract readonly authorizerProps: CfnAuthorizerProps;

  protected constructor(scope: Construct, id: string, props: LambdaAuthorizerProps) {
    super(scope, id);

    this.handler = props.handler;
    this.role = props.assumeRole;

    if (props.resultsCacheTtl && props.resultsCacheTtl?.toSeconds() > 3600) {
      throw new ValidationError('Lambda authorizer property \'resultsCacheTtl\' must not be greater than 3600 seconds (1 hour)', scope);
    }
  }

  /**
   * Attaches this authorizer to a specific REST API.
   * @internal
   */
  public _attachToApi(restApi: IRestApi) {
    if (this.restApiId && this.restApiId !== restApi.restApiId) {
      throw new ValidationError('Cannot attach authorizer to two different rest APIs', this);
    }

    this.restApiId = restApi.restApiId;

    const deployment = restApi.latestDeployment;
    const addToLogicalId = FeatureFlags.of(this).isEnabled(APIGATEWAY_AUTHORIZER_CHANGE_DEPLOYMENT_LOGICAL_ID);

    if (deployment && addToLogicalId) {
      let functionName;

      if (this.handler instanceof lambda.Function) {
        // if not imported, attempt to get the function name, which
        // may be a token
        functionName = (this.handler.node.defaultChild as lambda.CfnFunction).functionName;
      } else {
        // if imported, the function name will be a token
        functionName = this.handler.functionName;
      }

      deployment.node.addDependency(this);
      deployment.addToLogicalId({
        authorizer: this.authorizerProps,
        authorizerToken: functionName,
      });
    }
  }

  /**
   * Sets up the permissions necessary for the API Gateway service to invoke the Lambda function.
   */
  protected setupPermissions() {
    if (!this.role) {
      this.addDefaultPermissionRole();
    } else if (iam.Role.isRole(this.role)) {
      this.addLambdaInvokePermission(this.role);
    }
  }

  /**
   * Add Default Permission Role for handler
   */
  private addDefaultPermissionRole(): void {
    this.handler.addPermission(`${Names.uniqueId(this)}:Permissions`, {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: this.authorizerArn,
    });
  }

  /**
   * Add Lambda Invoke Permission for Lambda Authorizer's role
   */
  private addLambdaInvokePermission(role: iam.Role): void {
    role.attachInlinePolicy(new iam.Policy(this, 'authorizerInvokePolicy', {
      statements: [
        new iam.PolicyStatement({
          resources: this.handler.resourceArnsForGrantInvoke,
          actions: ['lambda:InvokeFunction'],
        }),
      ],
    }));
  }

  /**
   * Returns a token that resolves to the Rest Api Id at the time of synthesis.
   * Throws an error, during token resolution, if no RestApi is attached to this authorizer.
   */
  protected lazyRestApiId() {
    return Lazy.string({
      produce: () => {
        if (!this.restApiId) {
          throw new ValidationError(`Authorizer (${this.node.path}) must be attached to a RestApi`, this);
        }
        return this.restApiId;
      },
    });
  }
}

/**
 * Properties for TokenAuthorizer
 */
export interface TokenAuthorizerProps extends LambdaAuthorizerProps {
  /**
   * An optional regex to be matched against the authorization token. When matched the authorizer lambda is invoked,
   * otherwise a 401 Unauthorized is returned to the client.
   *
   * @default - no regex filter will be applied.
   */
  readonly validationRegex?: string;

  /**
   * The request header mapping expression for the bearer token. This is typically passed as part of the header, in which case
   * this should be `method.request.header.Authorizer` where `Authorizer` is the header containing the bearer token.
   *
   * @see https://docs.aws.amazon.com/apigateway/latest/api/API_CreateAuthorizer.html#apigw-CreateAuthorizer-request-identitySource
   * @default `IdentitySource.header('Authorization')`
   */
  readonly identitySource?: string;
}

/**
 * Token based lambda authorizer that recognizes the caller's identity as a bearer token,
 * such as a JSON Web Token (JWT) or an OAuth token.
 * Based on the token, authorization is performed by a lambda function.
 *
 * @resource AWS::ApiGateway::Authorizer
 */
@propertyInjectable
export class TokenAuthorizer extends LambdaAuthorizer {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string = 'aws-cdk-lib.aws-apigateway.TokenAuthorizer';
  public readonly authorizerId: string;

  public readonly authorizerArn: string;

  protected readonly authorizerProps: CfnAuthorizerProps;

  constructor(scope: Construct, id: string, props: TokenAuthorizerProps) {
    super(scope, id, props);
    // Enhanced CDK Analytics Telemetry
    addConstructMetadata(this, props);

    const restApiId = this.lazyRestApiId();

    const authorizerProps: CfnAuthorizerProps = {
      name: props.authorizerName ?? Names.uniqueId(this),
      restApiId,
      type: 'TOKEN',
      authorizerUri: lambdaAuthorizerArn(props.handler),
      authorizerCredentials: props.assumeRole?.roleArn,
      authorizerResultTtlInSeconds: props.resultsCacheTtl?.toSeconds() ?? Duration.minutes(5).toSeconds(),
      identitySource: props.identitySource || IdentitySource.header('Authorization'),
      identityValidationExpression: props.validationRegex,
    };

    this.authorizerProps = authorizerProps;

    const resource = new CfnAuthorizer(this, 'Resource', authorizerProps);

    this.authorizerId = resource.ref;
    this.authorizerArn = Stack.of(this).formatArn({
      service: 'execute-api',
      resource: restApiId,
      resourceName: `authorizers/${this.authorizerId}`,
    });

    this.setupPermissions();
  }
}

/**
 * Properties for RequestAuthorizer
 */
export interface RequestAuthorizerProps extends LambdaAuthorizerProps {
  /**
   * An array of request header mapping expressions for identities. Supported parameter types are
   * Header, Query String, Stage Variable, and Context. For instance, extracting an authorization
   * token from a header would use the identity source `IdentitySource.header('Authorization')`.
   *
   * Note: API Gateway uses the specified identity sources as the request authorizer caching key. When caching is
   * enabled, API Gateway calls the authorizer's Lambda function only after successfully verifying that all the
   * specified identity sources are present at runtime. If a specified identify source is missing, null, or empty,
   * API Gateway returns a 401 Unauthorized response without calling the authorizer Lambda function.
   *
   * @see https://docs.aws.amazon.com/apigateway/latest/api/API_CreateAuthorizer.html#apigw-CreateAuthorizer-request-identitySource
   */
  readonly identitySources: string[];
}

/**
 * Request-based lambda authorizer that recognizes the caller's identity via request parameters,
 * such as headers, paths, query strings, stage variables, or context variables.
 * Based on the request, authorization is performed by a lambda function.
 *
 * @resource AWS::ApiGateway::Authorizer
 */
@propertyInjectable
export class RequestAuthorizer extends LambdaAuthorizer {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string = 'aws-cdk-lib.aws-apigateway.RequestAuthorizer';
  public readonly authorizerId: string;

  public readonly authorizerArn: string;

  protected readonly authorizerProps: CfnAuthorizerProps;

  constructor(scope: Construct, id: string, props: RequestAuthorizerProps) {
    super(scope, id, props);
    // Enhanced CDK Analytics Telemetry
    addConstructMetadata(this, props);

    if ((props.resultsCacheTtl === undefined || props.resultsCacheTtl.toSeconds() !== 0) && props.identitySources.length === 0) {
      throw new ValidationError('At least one Identity Source is required for a REQUEST-based Lambda authorizer if caching is enabled.', scope);
    }

    const restApiId = this.lazyRestApiId();

    const authorizerProps: CfnAuthorizerProps = {
      name: props.authorizerName ?? Names.uniqueId(this),
      restApiId,
      type: 'REQUEST',
      authorizerUri: lambdaAuthorizerArn(props.handler),
      authorizerCredentials: props.assumeRole?.roleArn,
      authorizerResultTtlInSeconds: props.resultsCacheTtl?.toSeconds() ?? Duration.minutes(5).toSeconds(),
      identitySource: props.identitySources.map(is => is.toString()).join(','),
    };

    this.authorizerProps = authorizerProps;

    const resource = new CfnAuthorizer(this, 'Resource', authorizerProps);

    this.authorizerId = resource.ref;
    this.authorizerArn = Stack.of(this).formatArn({
      service: 'execute-api',
      resource: restApiId,
      resourceName: `authorizers/${this.authorizerId}`,
    });

    this.setupPermissions();
  }
}

/**
 * constructs the authorizerURIArn.
 */
function lambdaAuthorizerArn(handler: lambda.IFunction) {
  const { region, partition } = Arn.split( handler.functionArn, ArnFormat.COLON_RESOURCE_NAME);
  return `arn:${partition}:apigateway:${region}:lambda:path/2015-03-31/functions/${handler.functionArn}/invocations`;
}
