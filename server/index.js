import express from 'express';
import logger from 'morgan';
import dotenv from 'dotenv';
import { createClient } from '@libsql/client';
import { Server } from 'socket.io';
import { createServer } from 'node:http';

dotenv.config();

// Set up port for server
const port = process.env.PORT ?? 3000;

// Create express app and HTTP server
const app = express();
const server = createServer(app);
const io = new Server(server, {
  connectionStateRecovery: {}
});

// Set up database client
const db = createClient({
  url: 'libsql://sharp-the-call-chaos.turso.io',
  authToken: process.env.DB_TOKEN
});

// Ensure messages table exists
await db.execute(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT,
    user TEXT
  )
`);

// Handle socket connections
io.on('connection', async (socket) => {
  console.log('A user has connected!');

  socket.on('disconnect', () => {
    console.log('A user has disconnected');
  });

  socket.on('chat message', async (msg) => {
    let result;
    const username = socket.handshake.auth.username ?? 'anonymous';
    console.log({ username });
    try {
      result = await db.execute({
        sql: 'INSERT INTO messages (content, user) VALUES (:msg, :username)',
        args: { msg, username }
      });
    } catch (e) {
      console.error(e);
      return;
    }

    io.emit('chat message', msg, result.lastInsertRowid.toString(), username);
  });

  // Load messages for users that did not recover connection
  if (!socket.recovered) {
    try {
      const results = await db.execute({
        sql: 'SELECT id, content, user FROM messages WHERE id > ?',
        args: [socket.handshake.auth.serverOffset ?? 0]
      });

      results.rows.forEach(row => {
        socket.emit('chat message', row.content, row.id.toString(), row.user);
      });
    } catch (e) {
      console.error(e);
    }
  }
});

// Use morgan logger and serve static files
app.use(logger('dev'));
app.use(express.static('client'));

// Serve main HTML file on root route
app.get('/', (req, res) => {
  res.sendFile(process.cwd() + '/client/index.html');
});

// Start server
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
