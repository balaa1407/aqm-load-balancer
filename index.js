const http = require('http');
const httpProxy = require('http-proxy');

// --- Configuration ---
const PORT = 4000; // Switch to HTTP for easier load testing
const BACKENDS = [
    { url: 'http://127.0.0.1:3001', activeRequests: 0 },
    { url: 'http://127.0.0.1:3002', activeRequests: 0 },
    { url: 'http://127.0.0.1:3003', activeRequests: 0 }
];

// AQM (Active Queue Management) Parameters
const MAX_CONCURRENT_PER_BACKEND = 5; // To simulate capacity limits
const CODEL_TARGET_MS = 50;           // Acceptable wait time
const CODEL_INTERVAL_MS = 100;        // Observation window

// --- State ---
const queue = [];
const proxy = httpProxy.createProxyServer({});
let droppingState = false;
let firstAboveTargetTime = 0;
let totalRequests = 0;
let droppedRequests = 0;

// Error handling for proxy to prevent crashing
proxy.on('error', (err, req, res) => {
    if (res && res.writeHead) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway');
    }
});

// Proxy response hook to free up backend capacity
proxy.on('proxyRes', (proxyRes, req, res) => {
    if (req.assignedBackend) {
        req.assignedBackend.activeRequests--;
        processQueue(); // A slot freed up, process the next request
    }
});

// Proxy error hook to free up backend capacity on failure
proxy.on('error', (err, req, res) => {
    if (req.assignedBackend) {
        req.assignedBackend.activeRequests--;
        processQueue();
    }
});

// --- AQM CoDel Logic ---
function processQueue() {
    if (queue.length === 0) return;

    // 1. Find a backend with available capacity
    const availableBackend = BACKENDS.find(b => b.activeRequests < MAX_CONCURRENT_PER_BACKEND);
    if (!availableBackend) return; // No capacity right now, leave request in queue

    // 2. Dequeue the oldest request
    const { req, res, enqueueTime } = queue.shift();
    const now = Date.now();
    const sojournTime = now - enqueueTime;

    // 3. AQM / CoDel Evaluation
    let shouldDrop = false;

    if (sojournTime > CODEL_TARGET_MS) {
        if (firstAboveTargetTime === 0) {
            firstAboveTargetTime = now; // Mark when we first exceeded target
        } else if (now - firstAboveTargetTime >= CODEL_INTERVAL_MS) {
            // We have been above target for the entire interval. Enter dropping state.
            droppingState = true;
        }
    } else {
        // Wait time is good! Exit dropping state.
        firstAboveTargetTime = 0;
        droppingState = false;
    }

    if (droppingState && sojournTime > CODEL_TARGET_MS) {
        shouldDrop = true;
    }

    // 4. Action
    if (shouldDrop) {
        // [SHEDDING LOAD] Return 503 Service Unavailable immediately.
        droppedRequests++;
        console.log(`[DROP] Shedding load. Sojourn Time: ${sojournTime}ms`);
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('503 Service Unavailable: Server Overloaded');
        
        // Dropping this didn't use a backend slot, so process the NEXT item in queue instantly.
        processQueue();
    } else {
        // [FORWARDING] 
        availableBackend.activeRequests++;
        req.assignedBackend = availableBackend;
        proxy.web(req, res, { target: availableBackend.url });
    }
}

// --- HTTP Server Setup ---
const server = http.createServer((req, res) => {
    totalRequests++;
    
    // Add to the queue with a timestamp
    queue.push({ req, res, enqueueTime: Date.now() });
    
    // Attempt to process the queue
    processQueue();
});

server.listen(PORT, () => {
    console.log(`\n🚀 AQM Load Balancer running on port ${PORT}`);
    console.log(`- Queueing Mode: CoDel Active Queue Management`);
    console.log(`- Target Latency: ${CODEL_TARGET_MS}ms`);
    console.log(`- Capacity: ${MAX_CONCURRENT_PER_BACKEND} concurrent requests per backend`);
});

// Periodic logging to observe the experiment
setInterval(() => {
    const queueLength = queue.length;
    console.log(`[STATS] Queue: ${queueLength} | Total: ${totalRequests} | Dropped: ${droppedRequests} | Dropping State: ${droppingState}`);
}, 2000);
