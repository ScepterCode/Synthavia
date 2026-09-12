// Vercel entry point. Vercel runs the exported handler per request rather than keeping a
// listening server, so server.js exports its request handler and this file adapts it.
//
// Static assets under public/ are served by Vercel's CDN and never reach this function;
// vercel.json rewrites only the routes that need server rendering or the API.
const { handler } = require('../server.js');

module.exports = (request, response) => handler(request, response);
