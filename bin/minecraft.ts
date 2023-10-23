#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MinecraftStack } from '../lib/minecraft';

const app = new cdk.App();
new MinecraftEcsStack(app, 'MinecraftStack', {

});