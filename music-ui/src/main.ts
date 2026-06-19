import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/core';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
