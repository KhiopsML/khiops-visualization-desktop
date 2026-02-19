/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import { enableProdMode, provideAppInitializer, inject, importProvidersFrom } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

import { setupTranslateFactory } from './app/app.module';
import { APP_CONFIG } from './environments/environment';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { CommonModule } from '@angular/common';
import { BrowserModule, bootstrapApplication } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { MatomoModule } from 'ngx-matomo-client';
import { AppComponent } from './app/app.component';



if (APP_CONFIG.production) {
  enableProdMode();
}

bootstrapApplication(AppComponent, {
    providers: [
        importProvidersFrom(CommonModule, BrowserModule, FormsModule, TranslateModule.forRoot({
            loader: provideTranslateHttpLoader({
                prefix: './assets/i18n/',
                suffix: '.json',
            }),
        }), MatomoModule.forRoot({
            mode: 'deferred', // defer loading to set unique visitorId
        })),
        provideHttpClient(withInterceptorsFromDi()),
        TranslateService,
        provideAppInitializer(() => {
            const initializerFn = setupTranslateFactory(inject(TranslateService));
            return initializerFn();
        }),
    ]
})
  .catch(err => console.error(err));
