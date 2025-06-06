// disabling update workflow because we don't want to include the assets in the snapshot
// python bundling changes the asset hash pretty frequently
/// !cdk-integ pragma:disable-update-workflow
import * as path from 'path';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { App, Stack, StackProps } from 'aws-cdk-lib';
import { IntegTest, ExpectedResult } from '@aws-cdk/integ-tests-alpha';
import { Construct } from 'constructs';
import * as lambda from '../lib';

/*
 * Stack verification steps:
 * * aws lambda invoke --function-name <deployed fn name> --invocation-type Event --payload '"OK"' response.json
 */

class TestStack extends Stack {
  public readonly functionNames: string[] = [];
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const runtimes: Runtime[]= [
      Runtime.PYTHON_3_9, Runtime.PYTHON_3_10, Runtime.PYTHON_3_11, Runtime.PYTHON_3_12, Runtime.PYTHON_3_13,
    ];

    const uniqueRuntimes: Runtime[] = runtimes.filter((value, index, array) => array.findIndex(value1 => value1.runtimeEquals(value)) === index);

    uniqueRuntimes.forEach((runtime) => {
      const func = new lambda.PythonFunction(this, `func-${runtime.name}`, {
        entry: path.join(__dirname, 'lambda-handler'),
        runtime: runtime,
      });
      this.functionNames.push(func.functionName);
    });
  }
}

const app = new App({
  postCliContext: {
    '@aws-cdk/aws-lambda:useCdkManagedLogGroup': false,
  },
});
const testCase = new TestStack(app, 'integ-lambda-python-test-build-images');
const integ = new IntegTest(app, 'lambda-python-build-images', {
  testCases: [testCase],
  stackUpdateWorkflow: false,
});

testCase.functionNames.forEach(functionName => {
  const invoke = integ.assertions.invokeFunction({
    functionName: functionName,
  });

  invoke.expect(ExpectedResult.objectLike({
    Payload: '200',
  }));
});

app.synth();
