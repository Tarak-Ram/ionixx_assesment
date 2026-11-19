import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig, loadConfig } from './app.config';
import { Clock } from '../common/clock';

@Global()
@Module({})
export class ConfigModule {
  /** Pass an already-loaded config so it is parsed (and validated) exactly once at startup. */
  static register(config: AppConfig = loadConfig()): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: config }, Clock],
      exports: [APP_CONFIG, Clock],
    };
  }
}
