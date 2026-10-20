import { DataSource } from 'typeorm';
import { loadConfig } from '../config/app-config';
import { asOwner, dataSourceOptions } from './data-source';

// Entry point for the TypeORM CLI only (npm run migration:*, compose `migrate` service).
export default new DataSource(dataSourceOptions(loadConfig(asOwner(process.env))));
