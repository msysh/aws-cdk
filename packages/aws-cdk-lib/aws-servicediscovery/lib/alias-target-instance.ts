import { Construct } from 'constructs';
import { BaseInstanceProps, InstanceBase } from './instance';
import { NamespaceType } from './namespace';
import { DnsRecordType, IService, RoutingPolicy } from './service';
import { CfnInstance } from './servicediscovery.generated';
import { Names, ValidationError } from '../../core';
import { addConstructMetadata } from '../../core/lib/metadata-resource';
import { propertyInjectable } from '../../core/lib/prop-injectable';

/*
 * Properties for an AliasTargetInstance
 */
export interface AliasTargetInstanceProps extends BaseInstanceProps {
  /**
   * DNS name of the target
   */
  readonly dnsName: string;

  /**
   * The Cloudmap service this resource is registered to.
   */
  readonly service: IService;
}

/**
 * Instance that uses Route 53 Alias record type. Currently, the only resource types supported are Elastic Load
 * Balancers.
 *
 * @resource AWS::ServiceDiscovery::Instance
 */
@propertyInjectable
export class AliasTargetInstance extends InstanceBase {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string = 'aws-cdk-lib.aws-servicediscovery.AliasTargetInstance';
  /**
   * The Id of the instance
   */
  public readonly instanceId: string;

  /**
   * The Cloudmap service to which the instance is registered.
   */
  public readonly service: IService;

  /**
   * The Route53 DNS name of the alias target
   */
  public readonly dnsName: string;

  constructor(scope: Construct, id: string, props: AliasTargetInstanceProps) {
    super(scope, id);
    // Enhanced CDK Analytics Telemetry
    addConstructMetadata(this, props);

    if (props.service.namespace.type === NamespaceType.HTTP) {
      throw new ValidationError('Namespace associated with Service must be a DNS Namespace.', this);
    }

    // Should already be enforced when creating service, but validates if service is not instantiated with #createService
    const dnsRecordType = props.service.dnsRecordType;
    if (dnsRecordType !== DnsRecordType.A
      && dnsRecordType !== DnsRecordType.AAAA
      && dnsRecordType !== DnsRecordType.A_AAAA) {
      throw new ValidationError('Service must use `A` or `AAAA` records to register an AliasRecordTarget.', this);
    }

    if (props.service.routingPolicy !== RoutingPolicy.WEIGHTED) {
      throw new ValidationError('Service must use `WEIGHTED` routing policy.', this);
    }

    const resource = new CfnInstance(this, 'Resource', {
      instanceAttributes: {
        AWS_ALIAS_DNS_NAME: props.dnsName,
        ...props.customAttributes,
      },
      instanceId: props.instanceId || Names.uniqueId(this),
      serviceId: props.service.serviceId,
    });

    this.service = props.service;
    this.instanceId = resource.ref;
    this.dnsName = props.dnsName;
  }
}
