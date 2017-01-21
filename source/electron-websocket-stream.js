var read = require('readable-stream')
var concat = require('concat-stream')
var duplexify = require('duplexify')
var websocket = require('websocket-stream')
var browserify = require('browserify')
var parsefn = require('parse-function')

var https = require('https')
var fs = require('fs')
var url = require('url')
var path = require('path')

var electron = require('electron')

var transform = read.Transform

var app = electron.app
var BrowserWindow = electron.BrowserWindow

var electronProps = Object.keys(electron)
var isReady = false
var CRAWLERS = []
var register = {
  on: function (name, fn) { if (name === 'ready') CRAWLERS.push(fn) }
}
var SECRET = (''+Math.random()).substr(2)
var WINDOWS = {}


app.on('certificate-error', trustHandler)
function trustHandler (event, webContents, url, error, certificate, trust) {
  event.preventDefault()
  var decision
  if (url === url) { // Verification logic.
    // do your validation here
    decision = true
  }
  trust(decision)
}
var server = https.createServer({
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
}, httpHandler)

function httpHandler (request, response) {
  var args = request.url.split('-')
  var link = args[0]
  var ID = args[1]
  var debug = args[2]
  var method = request.method
  if (debug === 'debug') {
    console.log('==============================')
    // @TODO: refactor logging
    console.log(`HTTP:`)
    console.log('link', link)
    console.log('window-id', ID)
    console.log('referer',request.headers.referer)
    console.log('origin',request.headers.origin)
    console.log('==============================')
  }
  // response.setHeader('Access-Control-Allow-Headers', '*')
  // response.setHeader('Access-Control-Request-Method', '*')
  response.setHeader('Access-Control-Allow-Origin', '*')
  if (link === `/${SECRET}` && method === 'POST') {
    var body = []
    request.on('data', function(chunk) {
      body.push(chunk)
    }).on('end', function() {
      body = Buffer.concat(body).toString()
      // @TODO: refactor logging
      if (debug === 'debug') {
        console.log('----------------------------------------')
        console.error(`[BROWER WINDOW ${ID} ERROR]`)
        console.error(body)
        console.log('----------------------------------------')
      }
    })
    return response.end()
  }
  response.writeHead(404, { "Content-Type": "text/plain" })
  response.end()
}
server.listen(0, 'localhost', function (error) {
  if (error) throw error
  if (isReady) return CRAWLERS.forEach(function (fn) { fn() })
  isReady = true
})
var wss = websocket.createServer({
  server: server,
  clientTracking: true,
  verifyClient: function (info, verify) {
    var request = info.req
    var secure = info.secure
      // `true` if req.connection.authorized or req.connection.encrypted is set
    var origin = info.origin
    var args = request.url.split('-')
    var link = args[0]
    var ID = args[1]
    var debug = args[2]
    if (origin !== request.headers.origin) return verify(false)
    if (link !== `/${SECRET}`) return verify(false)
    if (debug === 'debug') {
      // @TODO: refactor logging
      console.log('==============================')
      console.log('WEBSOCKET:')
      console.log('window-id', ID)
      console.log({
        host: request.headers.host,
        url: link,
        secure: secure,
        origin: origin,
        method: request.method,
        key: request.headers['sec-websocket-key'],
        useragent: request.headers['user-agent'],
        domain: request.domain,
        statusCode: request.statusCode,
        statusMessage: request.statusMessage,
        httpVersion: request.httpVersion,
        wsVersion: request.headers['sec-websocket-version']
      })
      console.log('==============================')
    }
    verify(true)
  }
}, websocketHandler)
wss.on('error', function (error) {
// @TODO: refactor logging
  handleError(`websockket error: ${error}`)
})
wss.on('close', function (code, reason) {
// @TODO: refactor logging
  handleError(`close: ${code}, ${reason}`)
})
app.on('ready', function () {
  if (isReady) return CRAWLERS.forEach(function (fn) { fn() })
  isReady = true
})
process.on('error', function (e) { console.error(e) })
// process.on('uncaughtException', function (err) { })
process.on('exit', function () {
  Object.keys(WINDOWS).forEach(function (ID) {
    var X = WINDOWS[ID]
    if (X) {
      if (X.ws && X.ws.ws$) X.ws.ws$.destroy()
      if (X.bw) X.bw.destroy()
      WINDOWS[ID] = null
    }
  })
})

module.exports = crawler

function crawler (electronFn, options) {
  if (app.isReady() && server.listening) crawl()
  register.on('ready', crawl)
  function crawl () { start(electronFn, options) }
}
function websocketHandler (connection$) {
  var ID = connection$.socket.upgradeReq.url.split('-')[1]
  var X = WINDOWS[ID]
  var bw = X.bw
  var ws$ = X.ws.ws$
  var encode$ = X.ws.encode
  var decode$ = X.ws.decode
  ws$.on('error', function (error) { console.error('@TODO:error', error) })
  encode$.pipe(connection$)
  connection$.pipe(decode$) // pipe and/or buffer in through stream
  connection$.on('error', function (error) { console.error('@TODO:error', error) })
  connection$.on('message', function () { console.log('@TODO:message', arguments) })
  connection$.on('open', function () { console.log('@TODO:open', arguments) })
  ws$.on('close', function() {
    connection$.end()
    bw.destroy() // calls destroy on the readable and writable part (if present)
    WINDOWS[ID] = null
  })
  connection$.on("close", function () {
    bw.destroy()
    ws$.destroy() // calls destroy on the readable and writable part (if present)
    WINDOWS[ID] = null
  })
  bw.on('closed', function () { // @TODO: gets never triggered. remove?
    ws$.destroy()
    connection$.end()
    WINDOWS[ID] = null
  })
}
function start (electronFn, options) {
  function BrowserifyWindow (opts) { return BW(opts, options) }
  var fnobj = parseValidFunction(electronFn)
  var args = []
  fnobj.args.forEach(function (param) {
    if (param === 'BrowserifyWindow') return args.push(BrowserifyWindow)
    var index = electronProps.indexOf(param)
    if (index !== -1) args.push(electron[param])
  })
  electronFn.apply(null, args)
}
function handleError (err) {
  console.error(err) // print the error to STDERR
  process.exit(1) // exit program with non-zero exit code
}
function BW (opts, options) {
  var ID = (''+Math.random()).substr(2)
  var debug = (options||{}).debug ? 'debug' : 'silent'
  var addr = server.address()
  var href = url.format({
    slashes   : true,
    port      : addr.port,
    hostname  : addr.address,
    pathname  : `${SECRET}-${ID}-${debug}`
  })
  opts.nodeIntegration = false
  opts.show = false
  var bw = new BrowserWindow(opts)
  var o = { objectMode: true }
  var encode$ = transform(o)
  encode$._transform = function data2json (chunk, encoding, next) {
    if (chunk !== null && typeof chunk === 'object') {
      try { data = JSON.stringify(data) }
      catch (e) { next(e) }
    }
    next(null, chunk)
  }
  var decode$ = transform(o)
  decode$._transform = function json2data (chunk, encoding, next) {
    chunk = chunk.toString()
    if (chunk === 'undefined') chunk = undefined
    try { chunk = JSON.parse(chunk) }
    catch (e) { chunk = chunk }
    next(null, chunk)
  }
  var ws$ = duplexify(encode$, decode$, o)
  WINDOWS[ID] = { bw: bw, ws: { encode: encode$, decode: decode$, ws$: ws$ } }
  bw.once('ready-to-show', function () { bw.show() })
  bw.webContents.connectFunctionScript = connectFunctionScript
  var connected
  function connectFunctionScript (javascriptFn) {


    // @TODO: maybe enable again once the browser URL changes
    if (connected) handleError(`only one connection allowed per browser window`)
    connected = true


    if (!WINDOWS[ID]) handleError(`browser window is already closed`)
    var fnobj = parseValidFunction(javascriptFn)
    if (fnobj.args.indexOf('ws') !== 0) {
      // @TODO: refactor logging
      return handleError('browser function needs a first paramater named `ws`')
    }
    var browserScript = `;(function () {
      var read = require('readable-stream')
      var transform = read.Transform
      var duplexify = require('duplexify')
      var opts = { objectMode: true }
      var connection$ = require('websocket-stream')("wss://${href}", opts)
      var encode$ = transform(opts)
      encode$._transform = function data2json (chunk, encoding, next) {
        if (chunk !== null && typeof chunk === 'object') {
          try { chunk = JSON.stringify(chunk) }
          catch (e) { next(e) }
        }
        next(null, chunk)
      }
      var decode$ = transform(opts)
      decode$._transform = function json2data (chunk, encoding, next) {
        chunk = chunk.toString()
        if (chunk === 'undefined') chunk = undefined
        try { chunk = JSON.parse(chunk) }
        catch (e) { chunk = chunk }
        next(null, chunk)
      }
      var ws$ = duplexify(encode$, decode$, opts)
      encode$.pipe(connection$)
      connection$.pipe(decode$) // pipe and/or buffer in through stream
      connection$.on('error', function (error) { console.error('@TODO:error', error) })
      connection$.on('message', function () { console.log('@TODO:message', arguments) })
      connection$.on('open', function () { console.log('@TODO:open', arguments) })
      connection$.on("close", function () {
        ws$.destroy() // calls destroy on the readable and writable part (if present)
      })
      var minixhr = require('minixhr')
      var onerror = window.onerror
      window.onerror = function (msg, url, lineNo, columnNo, e) {
        if ('${debug}' === 'debug') {
          var ERR = {type:"error",name:e.name,msg:msg,stack:e.stack}
          minixhr({ url: "https://${href}", data: JSON.stringify(ERR) })
          return true
        }
      }
      ws$.on('error', function (e) {
        var ERR = {type:"error",name:e.name,msg:e.message,stack:e.stack}
        minixhr({ url: "https://${href}", data: JSON.stringify(ERR) })
      })
      ws$.on('message', function () { console.error('@TODO:@message', arguments) })
      ws$.on('open', function () { console.error('@TODO:@open', arguments) })
      ws$.on("close", function () {
        connection$.end()
        window.onerror = onerror
        minixhr = OPEN = ws$ = onerror = undefined
      })
      var OPEN = true
      ;(function (${fnobj.params}) { ${fnobj.body} })(ws$)
    })();`
    var entry$ = read({ read: function () {} })
    entry$.push(browserScript)
    entry$.push(null)
    var b$ = browserify(entry$).bundle()
    b$.on('error', handleError)
    b$.pipe(concat(function execute (code) {
      code = code.toString()
      bw.webContents.executeJavaScript(code)
    }))
    return ws$
  }
  return bw
}
function parseValidFunction (fn) {
  var fnobj = parsefn(fn)
  if (!fnobj.isValid || fnobj.isGenerator) {
    // @TODO: refactor logging
    return handleError('`javascriptFn` must be a valid function')
  }
  if (Array.from(new Set(fnobj.args)).length !== fnobj.args.length) {
    // @TODO: refactor logging
    return handleError('no duplicate parameter names in browser function')
  }
  return fnobj
}
