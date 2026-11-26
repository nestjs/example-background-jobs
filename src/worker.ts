import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';

// The same application without the HTTP server: it runs the email jobs, the outbox relay and the digest.
const app = await NestFactory.createApplicationContext(AppModule, { instrument: ObserveInstrument });
app.enableShutdownHooks();
