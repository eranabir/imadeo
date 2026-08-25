import { spawn } from 'node:child_process';

const [role, command, ...args] = process.argv.slice(2);
if (!role || !command) {
  throw new Error('Usage: node scripts/run-role.mjs <api|worker> <command> [...args]');
}

const child = spawn(command, args, {
  stdio: 'inherit',
  env: { ...process.env, IMADEO_ROLE: role },
  shell: process.platform === 'win32',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}

child.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
