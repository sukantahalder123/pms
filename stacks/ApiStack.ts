import { StackContext, Api, Table, Script } from "sst/constructs";
import { State, StateMachine } from "aws-cdk-lib/aws-stepfunctions";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Function } from "sst/constructs";
import { Duration } from "aws-cdk-lib/core";
export function API({ stack }: StackContext) {
	const pmsTable = new Table(stack, "pmsTable", {
		fields: {
			pk: "string",
			sk: "string",
			gsi1pk: "string",
			gsi1sk: "string",
			gsi2pk: "string",
			gsi2sk: "string",
		},
		primaryIndex: { partitionKey: "pk", sortKey: "sk" },
		globalIndexes: {
			gsi1: { partitionKey: "gsi1pk", sortKey: "gsi1sk" },
			gsi2: { partitionKey: "gsi2pk", sortKey: "gsi2sk" },
		},
		timeToLiveAttribute: "expiresAt",
	});

	const tables = [pmsTable];

	const processLambda = new Function(stack, "WorkflowProcessLambda", {
		handler:
			"packages/functions/stepFunctionLambda/workflow-process-lambda.handler",
	});

	const parallelTaskLambda = new Function(stack, "ParallelTaskLambda", {
		handler:
			"packages/functions/stepFunctionLambda/workflow-parallel-task-lambda.handler",
		bind: tables,
	});

	const completeStageLambda = new Function(stack, "CompleteStage", {
		handler:
			"packages/functions/stepFunctionLambda/workflow-complete-stage.handler",
		bind: tables,
	});

	const completeUsecaseLambda = new Function(stack, "CompleteUsecase", {
		handler:
			"packages/functions/stepFunctionLambda/workflow-complete-usecase.handler",
		bind: tables,
	});

	// Helper function to create a parallel task
	const createParallelTask = (id: string) => {
		return new tasks.LambdaInvoke(stack, id, {
			lambdaFunction: parallelTaskLambda,
			integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
			payload: sfn.TaskInput.fromObject({
				executionArn: sfn.JsonPath.stringAt("$$.Execution.Id"),
				token: sfn.JsonPath.taskToken,
				taskName: sfn.JsonPath.stringAt("$$.State.Name"),
				payload: sfn.JsonPath.entirePayload,
			}),
		});
	};

	// Helper function to create a process task
	const createProcessTask = (id: string) => {
		return new tasks.LambdaInvoke(stack, id, {
			lambdaFunction: processLambda,
			resultPath: "$",
			payloadResponseOnly: true,
			retryOnServiceExceptions: true,
			payload: sfn.TaskInput.fromObject({
				// Include the entire input payload
				payload: sfn.JsonPath.entirePayload,
				// Inject the state name
				stateName: sfn.JsonPath.stringAt("$$.State.Name"),
			}),
		});
	};

	// Helper function to create a complete stage task
	const createCompleteStageTask = (id: string) => {
		return new tasks.LambdaInvoke(stack, id, {
			lambdaFunction: completeStageLambda,
			payloadResponseOnly: true,

			resultPath: "$",
		});
	};

	// Define states
	const sRequirement = createProcessTask("Requirement");

	const sRequirementTasks = new sfn.Parallel(stack, "Requirement-tasks", {
		resultPath: "$.array",
	});

	sRequirementTasks.branch(createParallelTask("Create Use Case Document"));
	sRequirementTasks.branch(createParallelTask("Create Screen Designs"));
	sRequirementTasks.branch(
		createParallelTask(
			"Perform functional design review with the tech team"
		)
	);

	const sRequirementComplete = createCompleteStageTask(
		"Requirement-complete"
	);

	const sMockDev = createProcessTask("Mock Dev");

	const sMockDevTasks = new sfn.Parallel(stack, "Mock Dev-tasks", {
		resultPath: "$.array",
	});

	sMockDevTasks.branch(createParallelTask("Create OpenAPI Specification"));
	sMockDevTasks.branch(
		createParallelTask("Create Postman Tests for OpenAPI specification")
	);
	sMockDevTasks.branch(
		createParallelTask("Create UI screens working with Mock API")
	);
	sMockDevTasks.branch(createParallelTask("Create Test Plans"));

	const sMockDevComplete = createCompleteStageTask("Mock Dev-complete");

	const sActualDev = createProcessTask("Actual Dev");

	const sActualDevTasks = new sfn.Parallel(stack, "Actual Dev-tasks", {
		resultPath: "$.array",
	});

	sActualDevTasks.branch(
		createParallelTask(
			"Create Data Design Page in GitHub as MD file and link it in Netlify site"
		)
	);
	sActualDevTasks.branch(
		createParallelTask(
			"Create API source Code in GitHub and link it in Netlify site"
		)
	);
	sActualDevTasks.branch(
		createParallelTask("Populate Test data or sample data file in GitHub")
	);
	sActualDevTasks.branch(createParallelTask("Create Junit5 Tests in GitHub"));
	sActualDevTasks.branch(
		createParallelTask("Create Cucumber BDD tests in GitHub")
	);
	sActualDevTasks.branch(
		createParallelTask("Create Gatling Performance/Load Tests in GitHub")
	);
	sActualDevTasks.branch(
		createParallelTask("Perform Code Review with Tech Lead")
	);
	sActualDevTasks.branch(
		createParallelTask("Perform Actual UI-API integration")
	);
	sActualDevTasks.branch(createParallelTask("Merge Branch After review"));
	sActualDevTasks.branch(
		createParallelTask(
			"Link API source Code in GitHub and Netlify site in Use Cases Matrix"
		)
	);

	const sActualDevComplete = createCompleteStageTask("Actual Dev-complete");

	const sCICDTEST = createProcessTask("CI CD TEST");

	const sCICDTESTTasks = new sfn.Parallel(stack, "CI CD TEST tasks", {
		resultPath: "$.array",
	});

	sCICDTESTTasks.branch(
		createParallelTask(
			"Build, deploy, and test CI CD pipeline using custom Tekton"
		)
	);
	sCICDTESTTasks.branch(
		createParallelTask("Create Kubernetes Operator for the service")
	);
	sCICDTESTTasks.branch(
		createParallelTask("Deploy in Test ENV via CI CD pipeline")
	);
	sCICDTESTTasks.branch(
		createParallelTask("Perform acceptance tests in Test ENV")
	);
	sCICDTESTTasks.branch(
		createParallelTask(
			"Upload Test results to S3 website and link with Netlify website"
		)
	);
	sCICDTESTTasks.branch(
		createParallelTask("Upload Test ENV URL to Netlify site")
	);
	sCICDTESTTasks.branch(createParallelTask("Stage after review by lead"));

	const sCICDTESTComplete = createCompleteStageTask("CI CD TEST complete");

	const sStageRelease = createProcessTask("Stage Release");

	const sStageReleaseTasks = new sfn.Parallel(stack, "Stage Release tasks", {
		resultPath: "$.array",
	});

	sStageReleaseTasks.branch(
		createParallelTask("Perform stage tests and review by PM")
	);
	sStageReleaseTasks.branch(createParallelTask("PM promotes to production"));
	sStageReleaseTasks.branch(
		createParallelTask("PM performs API security tests in production")
	);
	sStageReleaseTasks.branch(
		createParallelTask("PM creates/updates release notes")
	);

	const sStageReleaseComplete = createCompleteStageTask(
		"Stage Release-complete"
	);

	const sPublishOperate = createProcessTask("Publish Operate");

	const sPublishOperateTasks = new sfn.Parallel(
		stack,
		"Publish Operate tasks",
		{
			resultPath: "$.array",
		}
	);

	sPublishOperateTasks.branch(
		createParallelTask(
			"DevOps team reviews Prod ENV from security & operation readiness perspective"
		)
	);
	sPublishOperateTasks.branch(
		createParallelTask("PM announces the release note to the world")
	);

	const sPublishOperateComplete = createCompleteStageTask(
		"Publish Operate-complete"
	);

	const sEnd = new tasks.LambdaInvoke(stack, "end", {
		lambdaFunction: completeUsecaseLambda,
	});

	// Define state machine
	const stateMachine = new StateMachine(
		stack,
		"SoftwareDevelopmentWorkflow",
		{
			definition: sRequirement
				.next(sRequirementTasks)
				.next(sRequirementComplete)
				.next(sMockDev)
				.next(sMockDevTasks)
				.next(sMockDevComplete)
				.next(sActualDev)
				.next(sActualDevTasks)
				.next(sActualDevComplete)
				.next(sCICDTEST)
				.next(sCICDTESTTasks)
				.next(sCICDTESTComplete)
				.next(sStageRelease)
				.next(sStageReleaseTasks)
				.next(sStageReleaseComplete)
				.next(sPublishOperate)
				.next(sPublishOperateTasks)
				.next(sPublishOperateComplete)
				.next(sEnd),
		}
	);

	const sWait = new sfn.Wait(stack, "Wait", {
		time: sfn.WaitTime.duration(Duration.seconds(1)),
	});

	// Define state machine
	const stateMachine1 = new sfn.StateMachine(stack, "StateMachine", {
		definition: sWait,
	});

	// const stepFunctionEnv = {
	// 	STEP_FUNCTION_NAME: stateMachine.stateMachineName,
	// 	STEP_FUNCTION_ARN: stateMachine.stateMachineArn,
	// };
	const api = new Api(stack, "api", {
		defaults: {
			function: {
				bind: tables,
			},
		},
		routes: {
			"POST /project":
				"packages/functions/api/project/project-post.handler",
			"GET /project/{id}":
				"packages/functions/api/project/project-get.handler",
			"GET /project":
				"packages/functions/api/project/project-name.handler",
			"POST /workflow": {
				function: {
					handler:
						"packages/functions/api/workflow/addWorkflowToProject.handler",
					permissions: ["states:DescribeStateMachine"],
				},
			},
			"GET /template": {
				function: {
					handler:
						"packages/functions/api/workflow/getTemplates.handler",
					permissions: ["states:DescribeStateMachine"],
				},
			},
			"DELETE /template/{id}":
				"packages/functions/api/workflow/deleteTemplate.handler",

			"POST /usecase": {
				function: {
					handler:
						"packages/functions/api/usecase/addusecase.handler",
					permissions: [
						"states:StartExecution",
						"states:DescribeStateMachine",
					],
				},
			},
			"GET /usecase/{id}":
				"packages/functions/api/usecase/getusecase.handler",
			"POST /resource":
				"packages/functions/api/resource/addResource.handler",
			"PUT /task/{id}/complete": {
				function: {
					handler: "packages/functions/api/task/completeTask.handler",
					permissions: ["states:SendTaskSuccess"],
				},
			},
			"PUT /task": "packages/functions/api/task/getTasks.handler",
		},
	});

	new Script(stack, "SeedScript", {
		defaults: {
			function: {
				bind: [pmsTable],
				environment: {
					TABLE_NAME: pmsTable.tableName,
					STEP_FUNCTIONS: JSON.stringify([
						{
							name: stateMachine.stateMachineName,
							arn: stateMachine.stateMachineArn,
						},
						{
							name: stateMachine1.stateMachineName,
							arn: stateMachine1.stateMachineArn,
						},
					]),
				},
			},
		},
		onCreate: "stacks/seed.seed",
		onUpdate: "stacks/seed.seed",
	});

	stack.addOutputs({
		LambdaApiEndpoint: api.url,
		SFNStack: stateMachine.stateMachineArn,
	});

	return {
		api,
		pmsTable,
		stateMachine,
	};
}
