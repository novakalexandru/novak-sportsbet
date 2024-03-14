import * as cdk from "aws-cdk-lib";
import { Stack, StackProps } from 'aws-cdk-lib';
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';

interface NovakPlaygroundProps extends StackProps {
    domainName: string;
    certificateArn: string;
}

export class NovakPlayground extends Stack {
    constructor(scope: Construct, id: string, props: NovakPlaygroundProps) {
        super(scope, id, props);

        // Create a new VPC
        const vpc = new ec2.Vpc(this, 'NovakPlaygroundVPC', {
            maxAzs: 3,
            natGateways: 1,
            subnetConfiguration: [
                {
                    cidrMask: 24,
                    name: 'PublicSubnet',
                    subnetType: ec2.SubnetType.PUBLIC,
                },
                {
                    cidrMask: 24,
                    name: 'PrivateSubnet',
                    subnetType: ec2.SubnetType.PRIVATE,
                }
            ]
        });

        // Create Security Group for ALB
        const albSecurityGroup = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
            vpc,
            description: 'Security group for ALB',
        });
        albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP traffic');
        albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS traffic');

        // Create the ECR repository
        const repository = new ecr.Repository(this, 'Repository', {
            imageScanOnPush: true,
            imageTagMutability: ecr.TagMutability.MUTABLE,
            repositoryName: 'novak-playground',
        });

        // Add the required permissions to the ECR repository
        repository.addToResourcePolicy(
            new iam.PolicyStatement({
                actions: [
                    'ecr:BatchCheckLayerAvailability',
                    'ecr:BatchGetImage',
                    'ecr:GetDownloadUrlForLayer',
                    'ecr:DescribeImages',
                    'ecr:DescribeRepositories',
                    'ecr:ListImages',
                    'ecr:GetRepositoryPolicy',
                    'ecr:GetAuthorizationToken',
                ],
                principals: [
                    new iam.ArnPrincipal('arn:aws:iam::123456789012:root'),
                ],
            }),
        );

        // Create a role for GitHub Actions to assume
        const githubActionsRole = new iam.Role(this, `GitHubActionsRole`, {
            roleName: `github-actions-role`,
            assumedBy: new iam.ServicePrincipal('github.com'),
        });

        // Attach policy to GitHub Actions role
        githubActionsRole.addToPolicy(
            new iam.PolicyStatement({
                actions: [
                    "ecr:BatchCheckLayerAvailability",
                    "ecr:InitiateLayerUpload",
                    "ecr:UploadLayerPart",
                    "ecr:CompleteLayerUpload",
                    "ecr:PutImage",
                    "ecr:BatchGetImage",
                    "ecr:GetDownloadUrlForLayer",
                ],
                resources: ["*"],
            })
        );

        // Create ECS Cluster
        const cluster = new ecs.Cluster(this, 'Cluster', {
            clusterName: "NovakPlaygroundCluster",
            vpc: vpc,
        });

        // Create ECS Task Definition
        const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
            cpu: 256,
            memoryLimitMiB: 512,
        });

        // Add a container to the task definition
        const container = taskDefinition.addContainer('Container', {
            image: ecs.ContainerImage.fromEcrRepository(repository),
            logging: new ecs.AwsLogDriver({
                streamPrefix: "NovakPlayground",
            }),
        });

        // Create ECS Service
        const service = new ecs.FargateService(this, "Service", {
            cluster,
            taskDefinition,
            desiredCount: 1,
            assignPublicIp: false,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                availabilityZones: ["eu-west-1a", "eu-west-1b", "eu-west-1c"],
            },
        });

        // Create ALB for the service
        const alb = new elbv2.ApplicationLoadBalancer(this, "ALB", {
            vpc: vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PUBLIC,
                availabilityZones: ["eu-west-1a", "eu-west-1b", "eu-west-1c"],
            },
            internetFacing: true,
            securityGroup: albSecurityGroup,
        });

        // Add HTTPS listener to ALB
        const listener = alb.addListener('Listener', {
            port: 443,
            open: true,
            protocol: elbv2.ApplicationProtocol.HTTPS,
            certificates: [elbv2.ListenerCertificate.fromCertificateManager(props.certificateArn)],
        });

        // Add a target group to the listener
        const targetGroup = listener.addTargets("ECS", {
            port: 80,
            targets: [service.loadBalancerTarget({
                containerName: "NovakPlaygroundContainer",
                containerPort: 80,
            })],
        });

        // Route 53 Alias for ALB
        const zone = route53.HostedZone.fromLookup(this, 'MyHostedZone', { domainName: props.domainName });
        new route53.ARecord(this, 'AliasRecord', {
            zone: zone,
            target: route53.RecordTarget.fromAlias(new route53targets.LoadBalancerTarget(alb)),
            recordName: props.domainName,
        });
    }
}
