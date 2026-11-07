// Docs: docs/03 - Features/Phone Entry.md
// Purpose: a one-time form on the home network: the TV shows its address as a QR code, the phone fills it, the TV gets the values.
package app.dholphin.tv

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.util.Base64
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.security.SecureRandom

/**
 * Plain HTTP on the home network, like the TV's other local services. A random token in the address means only the
 * phone that scanned the code can reach the form. It answers once, then stops; it also stops after 15 minutes.
 * The form never shows values the TV already has.
 */
class PhoneForm(private val context: Context, private val onValues: (JSONObject) -> Unit) {
    private var server: ServerSocket? = null
    private var token = ""
    private var title = ""
    private var fields = JSONArray()
    @Volatile private var deadline = 0L

    @Synchronized
    fun start(title: String, fields: JSONArray): JSONObject {
        stop()
        val ip = lanAddress() ?: return JSONObject().put("error", "This TV is not on a home network")
        this.title = title
        this.fields = fields
        token = ByteArray(16).also(SecureRandom()::nextBytes).joinToString("") { "%02x".format(it) }
        val s = ServerSocket().apply { reuseAddress = true; bind(InetSocketAddress(0)) }
        server = s
        deadline = System.currentTimeMillis() + 15 * 60_000
        Thread({ serve(s) }, "dholphin-phone").apply { isDaemon = true }.start()
        val url = "http://$ip:${s.localPort}/p/$token"
        return JSONObject().put("url", url).put("qr", qr(url))
    }

    @Synchronized
    fun stop() {
        runCatching { server?.close() }
        server = null
    }

    private fun serve(s: ServerSocket) {
        s.soTimeout = 30_000
        while (!s.isClosed) {
            if (System.currentTimeMillis() > deadline) return stop()
            val socket = try { s.accept() } catch (e: java.net.SocketTimeoutException) { continue } catch (e: Exception) { return }
            socket.use { handle(it) }
        }
    }

    private fun handle(socket: Socket) {
        socket.soTimeout = 10_000
        val input = socket.getInputStream().buffered()
        val requestLine = readLine(input) ?: return
        val headers = generateSequence { readLine(input)?.takeIf { it.isNotEmpty() } }.toList()
        val (method, path) = requestLine.split(' ').let { (it.getOrNull(0) ?: "") to (it.getOrNull(1) ?: "") }
        if (path != "/p/$token") return reply(socket, 404, page("Not found", "<p>This code has expired. Show the code on the TV again.</p>"))
        when (method) {
            "GET" -> reply(socket, 200, form())
            "POST" -> {
                val length = headers.firstOrNull { it.startsWith("content-length:", true) }?.substringAfter(':')?.trim()?.toIntOrNull() ?: 0
                if (length !in 1..16384) return reply(socket, 400, page("Too long", "<p>That is more than this form needs.</p>"))
                val body = ByteArray(length).also { b -> var n = 0; while (n < length) { val r = input.read(b, n, length - n); if (r < 0) break; n += r } }
                val values = JSONObject()
                val known = (0 until fields.length()).map { fields.getJSONObject(it).getString("key") }.toSet()
                String(body, Charsets.UTF_8).split('&').forEach { pair ->
                    val k = URLDecoder.decode(pair.substringBefore('='), "UTF-8")
                    val v = URLDecoder.decode(pair.substringAfter('=', ""), "UTF-8").trim()
                    if (k in known && v.isNotEmpty()) values.put(k, v.take(2048))
                }
                onValues(values)
                reply(socket, 200, page("Sent", "<p>Sent to your TV. You can close this page.</p>"))
                stop()
            }
            else -> reply(socket, 405, page("Not allowed", ""))
        }
    }

    private fun form(): String {
        // A field may open a section (a heading above it) and carry a hint (a placeholder, never a stored value).
        var section = ""
        val inputs = (0 until fields.length()).joinToString("") { i ->
            val f = fields.getJSONObject(i)
            val key = esc(f.getString("key"))
            val type = if (f.optBoolean("secret")) "password" else "text"
            val head = f.optString("section").takeIf { it.isNotEmpty() && it != section }?.also { section = it }?.let { "<h2>${esc(it)}</h2>" } ?: ""
            val hint = f.optString("placeholder").takeIf { it.isNotEmpty() }?.let { " placeholder=\"${esc(it)}\"" } ?: ""
            "$head<label>${esc(f.optString("label"))}<input name=\"$key\" type=\"$type\"$hint autocomplete=\"off\" autocapitalize=\"off\" spellcheck=\"false\"></label>"
        }
        return page(title, "<form method=\"post\">$inputs<button type=\"submit\">Send to the TV</button></form>")
    }

    private fun page(heading: String, body: String) = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Dholphin</title><style>
body{margin:0;padding:24px;background:#0E0E10;color:#F4F4F5;font:18px system-ui,sans-serif}
h1{font-size:24px;margin:0 0 20px}h2{font-size:19px;margin:28px 0 14px;padding-top:18px;border-top:1px solid #3A3A41}label{display:grid;gap:8px;margin-bottom:18px;font-weight:600}
input{font:inherit;padding:14px;border-radius:10px;border:2px solid #3A3A41;background:#18181B;color:inherit}
input:focus{outline:none;border-color:#F4F4F5}
button{font:inherit;font-weight:700;padding:14px 20px;border:0;border-radius:10px;background:#E5232D;color:#fff;width:100%}
button:active{transform:scale(.98)}p{color:#A9A9B2}
</style></head><body><h1>${esc(heading)}</h1>$body</body></html>"""

    private fun reply(socket: Socket, code: Int, html: String) {
        val bytes = html.toByteArray(Charsets.UTF_8)
        val status = mapOf(200 to "OK", 400 to "Bad Request", 404 to "Not Found", 405 to "Method Not Allowed")[code]
        val head = "HTTP/1.1 $code $status\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        socket.getOutputStream().apply { write(head.toByteArray()); write(bytes); flush() }
    }

    private fun readLine(input: java.io.InputStream): String? {
        val b = StringBuilder()
        while (b.length < 8192) {
            val c = input.read()
            if (c < 0) return if (b.isEmpty()) null else b.toString()
            if (c == '\n'.code) return b.toString().trimEnd('\r')
            b.append(c.toChar())
        }
        return null
    }

    /** The QR code as a PNG data address. Docs: ZXing/QRCodeWriter. */
    fun qr(text: String): String {
        val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.MARGIN to 1))
        val scale = 8
        val bmp = Bitmap.createBitmap(m.width * scale, m.height * scale, Bitmap.Config.ARGB_8888)
        for (y in 0 until m.height) for (x in 0 until m.width) {
            val c = if (m.get(x, y)) Color.BLACK else Color.WHITE
            for (dy in 0 until scale) for (dx in 0 until scale) bmp.setPixel(x * scale + dx, y * scale + dy, c)
        }
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
        return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    /** The TV's address on the home network: the first private IPv4 of an interface that is up. */
    private fun lanAddress(): String? = NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
        .filter { it.isUp && !it.isLoopback }
        .flatMap { it.inetAddresses.toList() }
        .filterIsInstance<Inet4Address>()
        .firstOrNull { it.isSiteLocalAddress }?.hostAddress

    private fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
}
