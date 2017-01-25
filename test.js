var electrows = require('./')

// duplex$ can send/receive data from a duplex stream
// if `electronFn` returns one.
var duplex$ = electrows(electronFn, { debug: false, show: false })

duplex$.write('send data to main process')
duplex$.on('data', function (data) {
  console.log('receive data from main process:', data)
})
/********************************************************************
  MAIN PROCESS
 list all electron API objects you want as parameter of `electronFn`

 e.g. function electron (app, BrowserWindow) { }
 e.g. function electronFn (BrowserifyWindow) { ... }

 `BrowserifyWindow` is additionally supported and
 returns a "BrowserWindow instance" that supports the
 additional method: `.connectFunctionScript` with one
 parameter `scriptFn`.

 Calling `.connectFunctionScript(myScriptFn)` requires
 `myScriptFn` to have it's first parameter named `ws` and
 returns a `websocket-stream` instance.
   * The returned `ws` instance lives in the main process.
   * The argument passed to the `ws` parameter of `myScriptFn`
     is the `websocket-stream` instance that lives in the
     render process.
   * This constitutes a real time stream connection
     that allows communication between the main and render process
********************************************************************/
function electronFn (BrowserifyWindow) {
  var opts = { width: 800, height: 600, show: true }
  var win = BrowserifyWindow(opts)
  win.loadURL('http://www.google.de')
  // win.openDevTools()
  var ws = win.webContents.connectFunctionScript(scriptFn)

  // listen to the 'data' event
  ws.on('data', function (data) {
    console.log('receive data in main process:')
    console.log(typeof data)
    console.log (data)
  })
  ws.on('end', function () { console.log('end') })
  ws.write('DATA2')
  // ws.on('finish', function () {console.log('finish')})
  // ws.on('close', function () {console.log('close')})
  // ws.on('exit', function () {console.log('exit')})
  // or pipe to another stream
  // ws.pipe(...)

  return ws // [optional] return a duplex stream
}
/********************************************************************
  MAIN PROCESS

  * `scriptFn` will be stringified and browserified to run in a BrowserWindow
  * `ws` parameter will be passed a websocket-stream instance arguments
       for communication with the main process
********************************************************************/
function scriptFn (ws) { //
  window.ws =ws
  var bel = require('bel')

  var element = bel`<h1> hello world </h1>`
  document.body.innerHTML = ''
  document.body.appendChild(element)

  var data = {
    title    : document.title,
    url      : location.href,
    content  : document.querySelector('h1').innerText
  }

  ws.on('data', function (data) {
    console.log('receive data in browserify window:')
    console.log(data)
  })
  ws.write(data) // sende data to the main process

  // ws.end() // closes the websocket stream & exits the BrowserifyWindow `win`

}
