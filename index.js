const http = require('http');
const ws = require('ws');
const express = require('express')
const morgan = require('morgan');

const app = express();
const server = http.createServer(app);
const wss = new ws.Server({ server });

wss.on('connection', (sock, req) => {
    console.log(`new websocket connection on url ${req.url}`);

    sock.on('message', msg => {
        console.log('data received: ', msg);

        // echo back the reverse cuz idk gotta do something to show it does something lol
        if(typeof msg === 'string') {
            msg = msg.split('').reverse().join('');
        } else {
            msg = 'im too lazy to handle non string cases';
        }

        sock.send(msg);
    });

    sock.on('close', (code, _) => {
        console.log(`websocket connection closed: ${code}`);
    });

    // lets also send a welcome message
    sock.send(`hi there im a ws server, connected on url ${req.url}`);
});

// lets ignore all /favicon requests
app.all('/favicon.ico', (req, res) => res.status(404).send());

// log all other requests, so we can see whats coming in
app.use(morgan('dev'));

// just serve static content
app.use(express.static('public', { fallthrough: false }))

server.listen(process.env.PORT || 3000, () => {
    console.log('Server started on', server.address());
});