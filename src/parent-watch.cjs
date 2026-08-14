'use strict'

// The desktop parent owns this stdin pipe but never writes to it. If Electron
// crashes or is force-killed, the OS closes the pipe and this process receives
// the same SIGTERM path used by the normal application shutdown.
if (process.stdin !== null) {
  process.stdin.resume()
  process.stdin.once('end', () => {
    process.kill(process.pid, 'SIGTERM')
  })
}
