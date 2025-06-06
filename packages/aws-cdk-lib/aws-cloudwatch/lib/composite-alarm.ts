import { Construct } from 'constructs';
import { AlarmBase, IAlarm, IAlarmRule } from './alarm-base';
import { CfnCompositeAlarm } from './cloudwatch.generated';
import { ArnFormat, Lazy, Names, Stack, Duration, ValidationError } from '../../core';
import { addConstructMetadata } from '../../core/lib/metadata-resource';
import { propertyInjectable } from '../../core/lib/prop-injectable';

/**
 * Properties for creating a Composite Alarm
 */
export interface CompositeAlarmProps {

  /**
   * Whether the actions for this alarm are enabled
   *
   * @default true
   */
  readonly actionsEnabled?: boolean;

  /**
   * Description for the alarm
   *
   * @default - No description.
   */
  readonly alarmDescription?: string;

  /**
   * Name of the alarm
   *
   * @default - Automatically generated name.
   */
  readonly compositeAlarmName?: string;

  /**
   * Expression that specifies which other alarms are to be evaluated to determine this composite alarm's state.
   */
  readonly alarmRule: IAlarmRule;

  /**
   * Actions will be suppressed if the suppressor alarm is in the ALARM state.
   *
   * @default - alarm will not be suppressed.
   */
  readonly actionsSuppressor?: IAlarm;

  /**
   * The maximum duration that the composite alarm waits after suppressor alarm goes out of the ALARM state.
   * After this time, the composite alarm performs its actions.
   *
   * @default - 1 minute extension period will be set.
   */
  readonly actionsSuppressorExtensionPeriod?: Duration;

  /**
   * The maximum duration that the composite alarm waits for the suppressor alarm to go into the ALARM state.
   * After this time, the composite alarm performs its actions.
   *
   * @default - 1 minute wait period will be set.
   */
  readonly actionsSuppressorWaitPeriod?: Duration;
}

/**
 * A Composite Alarm based on Alarm Rule.
 */
@propertyInjectable
export class CompositeAlarm extends AlarmBase {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string = 'aws-cdk-lib.aws-cloudwatch.CompositeAlarm';

  /**
   * Import an existing CloudWatch composite alarm provided an Name.
   *
   * @param scope The parent creating construct (usually `this`)
   * @param id The construct's name
   * @param compositeAlarmName Composite Alarm Name
   */
  public static fromCompositeAlarmName(scope: Construct, id: string, compositeAlarmName: string): IAlarm {
    const stack = Stack.of(scope);

    return this.fromCompositeAlarmArn(scope, id, stack.formatArn({
      service: 'cloudwatch',
      resource: 'alarm',
      resourceName: compositeAlarmName,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    }));
  }

  /**
   * Import an existing CloudWatch composite alarm provided an ARN.
   *
   * @param scope The parent creating construct (usually `this`)
   * @param id The construct's name
   * @param compositeAlarmArn Composite Alarm ARN (i.e. arn:aws:cloudwatch:<region>:<account-id>:alarm:CompositeAlarmName)
   */
  public static fromCompositeAlarmArn(scope: Construct, id: string, compositeAlarmArn: string): IAlarm {
    class Import extends AlarmBase implements IAlarm {
      public readonly alarmArn = compositeAlarmArn;
      public readonly alarmName = Stack.of(scope).splitArn(compositeAlarmArn, ArnFormat.COLON_RESOURCE_NAME).resourceName!;
    }
    return new Import(scope, id);
  }

  /**
   * ARN of this alarm
   *
   * @attribute
   */
  public readonly alarmArn: string;

  /**
   * Name of this alarm.
   *
   * @attribute
   */
  public readonly alarmName: string;

  private readonly alarmRule: string;

  constructor(scope: Construct, id: string, props: CompositeAlarmProps) {
    super(scope, id, {
      physicalName: props.compositeAlarmName ?? Lazy.string({ produce: () => this.generateUniqueId() }),
    });
    // Enhanced CDK Analytics Telemetry
    addConstructMetadata(this, props);

    if (props.alarmRule.renderAlarmRule().length > 10240) {
      throw new ValidationError('Alarm Rule expression cannot be greater than 10240 characters, please reduce the conditions in the Alarm Rule', this);
    }

    let extensionPeriod = props.actionsSuppressorExtensionPeriod;
    let waitPeriod = props.actionsSuppressorWaitPeriod;
    if (props.actionsSuppressor === undefined) {
      if (extensionPeriod !== undefined || waitPeriod !== undefined) {
        throw new ValidationError('ActionsSuppressor Extension/Wait Periods require an ActionsSuppressor to be set.', this);
      }
    } else {
      extensionPeriod = extensionPeriod ?? Duration.minutes(1);
      waitPeriod = waitPeriod ?? Duration.minutes(1);
    }

    this.alarmRule = props.alarmRule.renderAlarmRule();

    const alarm = new CfnCompositeAlarm(this, 'Resource', {
      alarmName: this.physicalName,
      alarmRule: this.alarmRule,
      alarmDescription: props.alarmDescription,
      actionsEnabled: props.actionsEnabled,
      alarmActions: Lazy.list({ produce: () => this.alarmActionArns }),
      insufficientDataActions: Lazy.list({ produce: (() => this.insufficientDataActionArns) }),
      okActions: Lazy.list({ produce: () => this.okActionArns }),
      actionsSuppressor: props.actionsSuppressor?.alarmArn,
      actionsSuppressorExtensionPeriod: extensionPeriod?.toSeconds(),
      actionsSuppressorWaitPeriod: waitPeriod?.toSeconds(),
    });

    this.alarmName = this.getResourceNameAttribute(alarm.ref);
    this.alarmArn = this.getResourceArnAttribute(alarm.attrArn, {
      service: 'cloudwatch',
      resource: 'alarm',
      resourceName: this.physicalName,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });
  }

  private generateUniqueId(): string {
    const name = Names.uniqueId(this);
    if (name.length > 240) {
      return name.substring(0, 120) + name.substring(name.length - 120);
    }
    return name;
  }
}
