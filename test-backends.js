const http = require('http');

const PORTS = [3001, 3002, 3003];
const PROCESSING_TIME_MS = 100; // Simulate actual work taking 100ms

PORTS.forEach(port => {
    const server = http.createServer((req, res) => {
        // Simulate a slow database query or heavy computation
        setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(`Success! Served by backend on port ${port}\n`);
        }, PROCESSING_TIME_MS);
    });

    server.listen(port, () => {
        console.log(`Backend server listening on port ${port} (Simulated Processing Time: ${PROCESSING_TIME_MS}ms)`);
    });
});
