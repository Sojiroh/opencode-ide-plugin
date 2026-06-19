package paviko.opencode.ui

import com.google.gson.Gson
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefBrowser
import java.awt.KeyboardFocusManager
import java.awt.KeyEventDispatcher
import java.awt.Image
import java.awt.datatransfer.DataFlavor
import java.awt.event.KeyEvent
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.concurrent.atomic.AtomicLong
import javax.imageio.ImageIO
import javax.swing.SwingUtilities
import org.cef.browser.CefBrowser
import org.cef.handler.CefKeyboardHandler.CefKeyEvent
import org.cef.handler.CefKeyboardHandlerAdapter
import org.cef.misc.BoolRef
import org.cef.misc.EventFlags

object ClipboardBridge {
    private val logger = Logger.getInstance(ClipboardBridge::class.java)
    private val gson = Gson()
    private val isLinux = System.getProperty("os.name")?.lowercase()?.contains("linux") == true

    fun install(browser: JBCefBrowser) {
        if (!isLinux) return

        val lastPaste = AtomicLong(0)
        fun pasteOnce(): Boolean {
            val now = System.currentTimeMillis()
            if (now - lastPaste.get() < 120) return true
            if (!pasteFromClipboard(browser.cefBrowser)) return false
            lastPaste.set(now)
            return true
        }

        browser.jbCefClient.addKeyboardHandler(object : CefKeyboardHandlerAdapter() {
            override fun onPreKeyEvent(browser: CefBrowser?, event: CefKeyEvent?, isKeyboardShortcut: BoolRef?): Boolean {
                if (!isPaste(event)) return false
                return pasteOnce()
            }

            override fun onKeyEvent(browser: CefBrowser?, event: CefKeyEvent?): Boolean {
                if (!isPaste(event)) return false
                return pasteOnce()
            }
        }, browser.cefBrowser)

        val keyboardFocusManager = KeyboardFocusManager.getCurrentKeyboardFocusManager()
        val dispatcher = KeyEventDispatcher { event ->
            if (event.id != KeyEvent.KEY_PRESSED) return@KeyEventDispatcher false
            if (!isPaste(event)) return@KeyEventDispatcher false
            val focusOwner = keyboardFocusManager.focusOwner ?: keyboardFocusManager.permanentFocusOwner
            if (focusOwner != browser.component && !SwingUtilities.isDescendingFrom(focusOwner, browser.component)) {
                return@KeyEventDispatcher false
            }
            pasteOnce()
        }
        keyboardFocusManager.addKeyEventDispatcher(dispatcher)
        Disposer.register(browser) {
            keyboardFocusManager.removeKeyEventDispatcher(dispatcher)
        }

        logger.info("Clipboard bridge installed for Linux")
    }

    private fun isPaste(event: CefKeyEvent?): Boolean {
        if (event == null) return false
        if (event.type != CefKeyEvent.EventType.KEYEVENT_RAWKEYDOWN) return false

        val isPasteShortcut =
            event.modifiers and EventFlags.EVENTFLAG_CONTROL_DOWN != 0 &&
                event.windows_key_code == KeyEvent.VK_V
        val isShiftInsert =
            event.modifiers and EventFlags.EVENTFLAG_SHIFT_DOWN != 0 &&
                event.windows_key_code == KeyEvent.VK_INSERT

        return isPasteShortcut || isShiftInsert
    }

    private fun isPaste(event: KeyEvent): Boolean {
        return (event.isControlDown && event.keyCode == KeyEvent.VK_V) ||
            (event.isShiftDown && event.keyCode == KeyEvent.VK_INSERT)
    }

    private fun pasteFromClipboard(browser: CefBrowser): Boolean {
        val manager = CopyPasteManager.getInstance()
        if (manager.areDataFlavorsAvailable(DataFlavor.imageFlavor)) {
            val image = manager.getContents(DataFlavor.imageFlavor) as? Image
            if (image != null) return pasteImageFromClipboard(browser, image)
        }

        if (!manager.areDataFlavorsAvailable(DataFlavor.stringFlavor)) return false

        val text = manager.getContents(DataFlavor.stringFlavor) as? String
        if (text.isNullOrEmpty()) return false

        browser.executeJavaScript(
            """
            (() => {
              const text = ${gson.toJson(text)};
              const active = document.activeElement;
              const target =
                active?.closest?.('[contenteditable="true"]') ??
                (active?.isContentEditable ? active : null) ??
                document.querySelector('[aria-placeholder^="Ask anything"][contenteditable="true"]') ??
                document.querySelector('[contenteditable="true"][role="textbox"]') ??
                document.querySelector('[contenteditable="true"]') ??
                active;

              if (!target) return;
              target.focus?.({ preventScroll: true });

              const custom = new CustomEvent("opencode:paste-text", {
                detail: { text },
                bubbles: true,
                cancelable: true,
              });
              target.dispatchEvent(custom);
              if (custom.defaultPrevented) return;

              if (typeof document.execCommand === "function") {
                document.execCommand("insertText", false, text);
              }
            })();
            """.trimIndent(),
            browser.url,
            0,
        )
        return true
    }

    private fun pasteImageFromClipboard(browser: CefBrowser, image: Image): Boolean {
        val png = ByteArrayOutputStream()
        if (!ImageIO.write(buffered(image), "png", png)) return false

        browser.executeJavaScript(
            """
            (() => {
              const base64 = ${gson.toJson(Base64.getEncoder().encodeToString(png.toByteArray()))};
              const mime = "image/png";
              const binary = atob(base64);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

              const file = new File([bytes], "clipboard-image.png", { type: mime });
              const data = new DataTransfer();
              data.items.add(file);

              const active = document.activeElement;
              const target =
                active?.closest?.('[contenteditable="true"]') ??
                (active?.isContentEditable ? active : null) ??
                document.querySelector('[aria-placeholder^="Ask anything"][contenteditable="true"]') ??
                document.querySelector('[contenteditable="true"][role="textbox"]') ??
                document.querySelector('[contenteditable="true"]') ??
                active;

              if (!target) return;
              target.focus?.({ preventScroll: true });
              target.dispatchEvent(new ClipboardEvent("paste", {
                clipboardData: data,
                bubbles: true,
                cancelable: true,
              }));
            })();
            """.trimIndent(),
            browser.url,
            0,
        )
        return true
    }

    private fun buffered(image: Image): BufferedImage {
        if (image is BufferedImage) return image
        val width = image.getWidth(null)
        val height = image.getHeight(null)
        val result = BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB)
        val graphics = result.createGraphics()
        graphics.drawImage(image, 0, 0, null)
        graphics.dispose()
        return result
    }
}
