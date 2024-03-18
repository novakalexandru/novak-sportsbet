#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NovakPlayground } from '../lib/novak-playground-stack';

const app = new cdk.App();
new NovakPlayground(app, 'NovakPlaygroundStack', {
    domainName: 'novak-playground.com',
    certificateArn: 'arn:aws:acm:region:123456789:certificate/random-arn',
});
