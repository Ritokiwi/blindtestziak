const { spawn } = require('child_process');

const port = process.env.PORT || 3040;
const child = spawn('npx', ['vercel', 'dev', '--cwd', __dirname, '--local', '-y', '--listen', String(port)], {
  stdio: 'inherit',
  shell: true
});
child.on('exit', code => process.exit(code ?? 0));
