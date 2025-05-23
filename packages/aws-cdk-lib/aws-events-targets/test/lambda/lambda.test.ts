import * as constructs from 'constructs';
import { Annotations, Template, Match } from '../../../assertions';
import * as events from '../../../aws-events';
import * as lambda from '../../../aws-lambda';
import * as sqs from '../../../aws-sqs';
import * as cdk from '../../../core';
import * as targets from '../../lib';

test('use lambda as an event rule target', () => {
  // GIVEN
  const stack = new cdk.Stack();
  const fn = newTestLambda(stack);
  const rule1 = new events.Rule(stack, 'Rule', {
    schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
  });
  const rule2 = new events.Rule(stack, 'Rule2', {
    schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
  });

  // WHEN
  rule1.addTarget(new targets.LambdaFunction(fn));
  rule2.addTarget(new targets.LambdaFunction(fn));

  // THEN
  const lambdaId = 'MyLambdaCCE802FB';

  Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Permission', {
    Action: 'lambda:InvokeFunction',
    FunctionName: {
      'Fn::GetAtt': [
        lambdaId,
        'Arn',
      ],
    },
    Principal: 'events.amazonaws.com',
    SourceArn: { 'Fn::GetAtt': ['Rule4C995B7F', 'Arn'] },
  });

  Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Permission', {
    Action: 'lambda:InvokeFunction',
    FunctionName: {
      'Fn::GetAtt': [
        lambdaId,
        'Arn',
      ],
    },
    Principal: 'events.amazonaws.com',
    SourceArn: { 'Fn::GetAtt': ['Rule270732244', 'Arn'] },
  });

  Template.fromStack(stack).resourceCountIs('AWS::Events::Rule', 2);
  Template.fromStack(stack).hasResourceProperties('AWS::Events::Rule', {
    Targets: [
      {
        Arn: { 'Fn::GetAtt': [lambdaId, 'Arn'] },
        Id: 'Target0',
      },
    ],
  });
});

test('adding same lambda function as target mutiple times creates permission only once', () => {
  // GIVEN
  const stack = new cdk.Stack();
  const fn = newTestLambda(stack);
  const rule = new events.Rule(stack, 'Rule', {
    schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
  });

  // WHEN
  rule.addTarget(new targets.LambdaFunction(fn, {
    event: events.RuleTargetInput.fromObject({ key: 'value1' }),
  }));
  rule.addTarget(new targets.LambdaFunction(fn, {
    event: events.RuleTargetInput.fromObject({ key: 'value2' }),
  }));

  // THEN
  Template.fromStack(stack).resourceCountIs('AWS::Lambda::Permission', 1);
});

test('adding different lambda functions as target mutiple times creates multiple permissions', () => {
  // GIVEN
  const stack = new cdk.Stack();
  const fn1 = newTestLambda(stack);
  const fn2 = newTestLambda(stack, '2');
  const rule = new events.Rule(stack, 'Rule', {
    schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
  });

  // WHEN
  rule.addTarget(new targets.LambdaFunction(fn1, {
    event: events.RuleTargetInput.fromObject({ key: 'value1' }),
  }));
  rule.addTarget(new targets.LambdaFunction(fn2, {
    event: events.RuleTargetInput.fromObject({ key: 'value2' }),
  }));

  // THEN
  Template.fromStack(stack).resourceCountIs('AWS::Lambda::Permission', 2);
});

test('adding same singleton lambda function as target mutiple times creates permission only once', () => {
  // GIVEN
  const stack = new cdk.Stack();
  const fn = new lambda.SingletonFunction(stack, 'MyLambda', {
    code: new lambda.InlineCode('foo'),
    handler: 'bar',
    runtime: lambda.Runtime.PYTHON_3_9,
    uuid: 'uuid',
  });
  const rule = new events.Rule(stack, 'Rule', {
    schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
  });

  // WHEN
  rule.addTarget(new targets.LambdaFunction(fn, {
    event: events.RuleTargetInput.fromObject({ key: 'value1' }),
  }));
  rule.addTarget(new targets.LambdaFunction(fn, {
    event: events.RuleTargetInput.fromObject({ key: 'value2' }),
  }));

  // THEN
  Template.fromStack(stack).resourceCountIs('AWS::Lambda::Permission', 1);
});

test('lambda handler and cloudwatch event across stacks', () => {
  // GIVEN
  const app = new cdk.App();
  const lambdaStack = new cdk.Stack(app, 'LambdaStack');

  const fn = new lambda.Function(lambdaStack, 'MyLambda', {
    code: new lambda.InlineCode('foo'),
    handler: 'bar',
    runtime: lambda.Runtime.PYTHON_3_9,
  });

  const eventStack = new cdk.Stack(app, 'EventStack');
  new events.Rule(eventStack, 'Rule', {
    schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
    targets: [new targets.LambdaFunction(fn)],
  });

  expect(() => app.synth()).not.toThrow();

  // the Permission resource should be in the event stack
  Template.fromStack(eventStack).resourceCountIs('AWS::Lambda::Permission', 1);
});

test('use a Dead Letter Queue for the rule target', () => {
  // GIVEN
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'Stack');

  const fn = new lambda.Function(stack, 'MyLambda', {
    code: new lambda.InlineCode('foo'),
    handler: 'bar',
    runtime: lambda.Runtime.PYTHON_3_9,
  });

  const queue = new sqs.Queue(stack, 'Queue');

  new events.Rule(stack, 'Rule', {
    schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
    targets: [new targets.LambdaFunction(fn, {
      deadLetterQueue: queue,
    })],
  });

  expect(() => app.synth()).not.toThrow();

  // the Permission resource should be in the event stack
  Template.fromStack(stack).hasResourceProperties('AWS::Events::Rule', {
    Targets: [
      {
        Arn: {
          'Fn::GetAtt': [
            'MyLambdaCCE802FB',
            'Arn',
          ],
        },
        DeadLetterConfig: {
          Arn: {
            'Fn::GetAtt': [
              'Queue4A7E3555',
              'Arn',
            ],
          },
        },
        Id: 'Target0',
      },
    ],
  });

  Template.fromStack(stack).hasResourceProperties('AWS::SQS::QueuePolicy', {
    PolicyDocument: {
      Statement: [
        {
          Action: 'sqs:SendMessage',
          Condition: {
            ArnEquals: {
              'aws:SourceArn': {
                'Fn::GetAtt': [
                  'Rule4C995B7F',
                  'Arn',
                ],
              },
            },
          },
          Effect: 'Allow',
          Principal: {
            Service: 'events.amazonaws.com',
          },
          Resource: {
            'Fn::GetAtt': [
              'Queue4A7E3555',
              'Arn',
            ],
          },
          Sid: 'AllowEventRuleStackRuleF6E31DD0',
        },
      ],
      Version: '2012-10-17',
    },
    Queues: [
      {
        Ref: 'Queue4A7E3555',
      },
    ],
  });
});

test('throw an error when using a Dead Letter Queue for the rule target in a different region', () => {
  // GIVEN
  const app = new cdk.App();
  const stack1 = new cdk.Stack(app, 'Stack1', {
    env: {
      region: 'eu-west-1',
    },
  });
  const stack2 = new cdk.Stack(app, 'Stack2', {
    env: {
      region: 'eu-west-2',
    },
  });

  const fn = new lambda.Function(stack1, 'MyLambda', {
    code: new lambda.InlineCode('foo'),
    handler: 'bar',
    runtime: lambda.Runtime.PYTHON_3_9,
  });

  const queue = new sqs.Queue(stack2, 'Queue');

  let rule = new events.Rule(stack1, 'Rule', {
    schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
  });

  expect(() => {
    rule.addTarget(new targets.LambdaFunction(fn, {
      deadLetterQueue: queue,
    }));
  }).toThrow(/Cannot assign Dead Letter Queue in region eu-west-2 to the rule Stack1Rule92BA1111 in region eu-west-1. Both the queue and the rule must be in the same region./);
});

test('must display a warning when using a Dead Letter Queue from another account', () => {
  // GIVEN
  const app = new cdk.App();
  const stack1 = new cdk.Stack(app, 'Stack1', {
    env: {
      region: 'eu-west-1',
      account: '111111111111',
    },
  });

  const stack2 = new cdk.Stack(app, 'Stack2', {
    env: {
      region: 'eu-west-1',
      account: '222222222222',
    },
  });

  const fn = new lambda.Function(stack1, 'MyLambda', {
    code: new lambda.InlineCode('foo'),
    handler: 'bar',
    runtime: lambda.Runtime.PYTHON_3_9,
  });

  const queue = sqs.Queue.fromQueueArn(stack2, 'Queue', 'arn:aws:sqs:eu-west-1:444455556666:queue1');

  new events.Rule(stack1, 'Rule', {
    schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
    targets: [new targets.LambdaFunction(fn, {
      deadLetterQueue: queue,
    })],
  });

  expect(() => app.synth()).not.toThrow();

  // the Permission resource should be in the event stack
  Template.fromStack(stack1).hasResourceProperties('AWS::Events::Rule', {
    ScheduleExpression: 'rate(1 minute)',
    State: 'ENABLED',
    Targets: [
      {
        Arn: {
          'Fn::GetAtt': [
            'MyLambdaCCE802FB',
            'Arn',
          ],
        },
        DeadLetterConfig: {
          Arn: 'arn:aws:sqs:eu-west-1:444455556666:queue1',
        },
        Id: 'Target0',
      },
    ],
  });

  Template.fromStack(stack1).resourceCountIs('AWS::SQS::QueuePolicy', 0);

  Annotations.fromStack(stack1).hasWarning('/Stack1/Rule', Match.stringLikeRegexp(
    'Cannot add a resource policy to your dead letter queue associated with rule \\${Token\\[TOKEN\\.[0-9]+\\]} because the queue is in a different account\\. You must add the resource policy manually to the dead letter queue in account 444455556666\\. \\[ack: @aws-cdk/aws-events-targets:manuallyAddDLQResourcePolicy\\]',
  ));
});

test('specifying retry policy', () => {
  // GIVEN
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'Stack');

  const fn = new lambda.Function(stack, 'MyLambda', {
    code: new lambda.InlineCode('foo'),
    handler: 'bar',
    runtime: lambda.Runtime.PYTHON_3_9,
  });

  // WHEN
  new events.Rule(stack, 'Rule', {
    schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
    targets: [new targets.LambdaFunction(fn, {
      retryAttempts: 2,
      maxEventAge: cdk.Duration.hours(2),
    })],
  });

  // THEN
  expect(() => app.synth()).not.toThrow();

  // the Permission resource should be in the event stack
  Template.fromStack(stack).hasResourceProperties('AWS::Events::Rule', {
    ScheduleExpression: 'rate(1 minute)',
    State: 'ENABLED',
    Targets: [
      {
        Arn: {
          'Fn::GetAtt': [
            'MyLambdaCCE802FB',
            'Arn',
          ],
        },
        Id: 'Target0',
        RetryPolicy: {
          MaximumEventAgeInSeconds: 7200,
          MaximumRetryAttempts: 2,
        },
      },
    ],
  });
});

test('specifying retry policy with 0 retryAttempts', () => {
  // GIVEN
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'Stack');

  const fn = new lambda.Function(stack, 'MyLambda', {
    code: new lambda.InlineCode('foo'),
    handler: 'bar',
    runtime: lambda.Runtime.PYTHON_3_9,
  });

  // WHEN
  new events.Rule(stack, 'Rule', {
    schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
    targets: [new targets.LambdaFunction(fn, {
      retryAttempts: 0,
    })],
  });

  // THEN
  expect(() => app.synth()).not.toThrow();

  // the Permission resource should be in the event stack
  Template.fromStack(stack).hasResourceProperties('AWS::Events::Rule', {
    ScheduleExpression: 'rate(1 minute)',
    State: 'ENABLED',
    Targets: [
      {
        Arn: {
          'Fn::GetAtt': [
            'MyLambdaCCE802FB',
            'Arn',
          ],
        },
        Id: 'Target0',
        RetryPolicy: {
          MaximumRetryAttempts: 0,
        },
      },
    ],
  });
});

function newTestLambda(scope: constructs.Construct, suffix = '') {
  return new lambda.Function(scope, `MyLambda${suffix}`, {
    code: new lambda.InlineCode('foo'),
    handler: 'bar',
    runtime: lambda.Runtime.PYTHON_3_9,
  });
}
