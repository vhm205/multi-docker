const keys = require("./keys");

// Express App Setup
const express = require("express");
const bodyParser = require("body-parser");
const fs = require('fs');
const http2 = require('http2');
const http2Express = require('http2-express-bridge');
const path = require('path');
const cors = require("cors");

// const app = http2Express(express);
const app = express();
app.use(cors());
app.use(bodyParser.json());

const staticPath = path.join(__dirname, 'public');
app.use(express.static(staticPath));

// Postgres Client Setup
const { Pool } = require("pg");
const pgClient = new Pool({
  user: keys.pgUser,
  host: keys.pgHost,
  database: keys.pgDatabase,
  password: keys.pgPassword,
  port: keys.pgPort,
});

pgClient.on("connect", (client) => {
  client
    .query("CREATE TABLE IF NOT EXISTS values (number INT)")
    .catch((err) => console.error(err));
});

// Redis Client Setup
const redis = require("redis");
const redisClient = redis.createClient({
  host: keys.redisHost,
  port: keys.redisPort,
  retry_strategy: () => 1000,
});
const redisPublisher = redisClient.duplicate();

// Express route handlers

app.get("/express", (req, res) => {
  res.sendFile('public/index.html', { root: __dirname })
});

app.get("/values/all", async (req, res) => {
  const values = await pgClient.query("SELECT * from values");

  res.send(values.rows);
});

app.get("/values/current", async (req, res) => {
  redisClient.hgetall("values", (err, values) => {
    res.send(values);
  });
});

app.post("/values", async (req, res) => {
  const index = req.body.idex;

  if (parseInt(index) > 40) {
    return res.status(422).send("Index too high");
  }

  redisClient.hset("values", index, "Nothing yet!");
  redisPublisher.publish("insert", index);
  pgClient.query("INSERT INTO values(number) VALUES($1)", [index]);

  res.send({ working: true });
});

app.get('/subscribe', async (req, res) => {
	res.writeHead(200, {
		'Content-Type': 'text/event-stream',
		Connection: 'keep-alive',
		'Cache-control': 'no-cache',
	});

	let counter = 0;

  // Serverside implementation of event 'current-date'
  res.write('event: current-date\n');
  res.write(`data: ${new Date().toLocaleString()}\n`);
  res.write(`id: ${counter}\n\n`);

	// Send a message on connection
	res.write('event: connected\n');
	res.write(`data: You are now subscribed!\n`);
	res.write(`id: ${counter}\n\n`);
	counter += 1;

	// Send a subsequent message every five seconds
	setInterval(() => {
		res.write('event: message\n');
		res.write(`data: ${new Date().toLocaleString()}\n`);
		res.write(`id: ${counter}\n\n`);
		counter += 1;
	}, 1000);

  res.on('close', () => res.send('Closed!!'))
});

app.post('/upload', async (req, res) => {
	const filePath = path.join(__dirname, `/file.pdf`);
	const stream = fs.createWriteStream(filePath);

	stream.on('open', () => req.pipe(stream));
	stream.on('finish', () => console.log('Stream is finish'));

	stream.on('drain', () => {
		// Calculate how much data has been piped yet
		const written = parseInt(stream.bytesWritten);
		const total = parseInt(req.headers['content-length']);
		const pWritten = ((written / total) * 100).toFixed(2);
		console.log(`Processing  ...  ${pWritten}% done`);
	});

	stream.on('close', () => {
		// Send a success response back to the client
		const msg = `Data uploaded to ${filePath}`;
		console.log('Processing  ...  100%');
		console.log(msg);
		res.status(200).send({ status: 'success', msg });
	});

	stream.on('error', (err) => {
		// Send an error message to the client
		console.error(err);
		res.status(500).send({ status: 'error', err });
	});

	req.on('data', (chunk) => {
		console.log({ chunk });
	});
  console.log('DONE');
});

// const server = http2.createSecureServer({
//   allowHTTP1: true,
//   key: fs.readFileSync('./cer/key.pem'),
//   cert: fs.readFileSync('./cer/cert.pem'),
// }, app);

// server.on('stream', (stream, headers) => {
//   console.log({ headers, pushAllowed: stream.pushAllowed });
//   if(stream.pushAllowed) {
//     stream.respond({ ':status': 200 });
//     stream.end('some data');
//     return;
//   }
// });

// server.listen(5001);

app.listen(5001, (err) => {
  console.log("Listening");
});
