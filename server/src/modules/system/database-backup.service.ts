import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '../../config/configuration';

interface BackupFile {
  path: string;
  fileName: string;
  size: number;
  cleanup: () => Promise<void>;
}

interface CommandFailure extends Error {
  code?: string;
  stderr?: string;
}

@Injectable()
export class DatabaseBackupService {
  private readonly logger = new Logger(DatabaseBackupService.name);
  private running = false;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async create(): Promise<BackupFile> {
    if (this.running) throw new ConflictException('A database backup is already running');

    const databaseUrl = this.config.get('database.url', { infer: true });
    if (!databaseUrl) throw new ServiceUnavailableException('The database connection is not configured');

    const directory = await mkdtemp(join(tmpdir(), 'imadeo-database-backup-'));
    const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
    const fileName = `imadeo-database-${stamp}.dump`;
    const path = join(directory, fileName);
    const cleanup = () => rm(directory, { recursive: true, force: true });

    this.running = true;
    try {
      await this.dump(databaseUrl, path);
      const details = await stat(path);
      if (details.size === 0) throw new Error('pg_dump produced an empty file');
      return { path, fileName, size: details.size, cleanup };
    } catch (error) {
      await cleanup();
      const failure = error as CommandFailure;
      this.logger.error(failure.stderr || failure.message, failure.stack);
      if (failure.code === 'ENOENT') {
        throw new ServiceUnavailableException('The database backup tool is not installed on this server');
      }
      throw new InternalServerErrorException('The database backup could not be created');
    } finally {
      this.running = false;
    }
  }

  private async dump(databaseUrl: string, outputPath: string) {
    const connection = new URL(databaseUrl);
    const password = decodeURIComponent(connection.password);
    connection.password = '';
    // Prisma accepts pool and schema options in this URL; libpq does not.
    for (const option of [
      'schema',
      'connection_limit',
      'pool_timeout',
      'pgbouncer',
      'socket_timeout',
    ]) {
      connection.searchParams.delete(option);
    }

    try {
      await this.run(
        'pg_dump',
        [
          '--dbname',
          connection.toString(),
          '--format=custom',
          '--no-owner',
          '--no-privileges',
          '--file',
          outputPath,
        ],
        { ...process.env, PGPASSWORD: password },
      );
    } catch (error) {
      const failure = error as CommandFailure;
      if (failure.code !== 'ENOENT' || this.config.get('env', { infer: true }) === 'production') {
        throw error;
      }

      // Local development keeps PostgreSQL in Docker while the API runs on the
      // host. The release image has pg_dump installed and never uses this path.
      await this.runDockerDump(connection, outputPath);
    }
  }

  private runDockerDump(connection: URL, outputPath: string) {
    const user = decodeURIComponent(connection.username);
    const database = decodeURIComponent(connection.pathname.replace(/^\//, ''));

    return new Promise<void>((resolve, reject) => {
      const output = createWriteStream(outputPath, { flags: 'wx' });
      const child = spawn(
        'docker',
        [
          'exec',
          'imadeo_postgres',
          'pg_dump',
          '--username',
          user,
          '--dbname',
          database,
          '--format=custom',
          '--no-owner',
          '--no-privileges',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < 64_000) stderr += chunk;
      });
      child.stdout.pipe(output);
      child.once('error', (error: CommandFailure) => reject(error));
      output.once('error', reject);
      child.once('close', (code) => {
        output.end(() => {
          if (code === 0) resolve();
          else reject(Object.assign(new Error(`pg_dump exited with code ${code}`), { stderr }));
        });
      });
    });
  }

  private run(command: string, args: string[], env: NodeJS.ProcessEnv) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < 64_000) stderr += chunk;
      });
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) resolve();
        else reject(Object.assign(new Error(`${command} exited with code ${code}`), { stderr }));
      });
    });
  }
}
