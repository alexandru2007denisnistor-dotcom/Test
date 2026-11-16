package app.glassgym.training;

import android.os.Bundle;
import android.view.Display;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestHighestRefreshRate();
    }

    @Override
    public void onResume() {
        super.onResume();
        // Manche Hersteller-Oberflächen (z. B. ColorOS) setzen die Rate zurück
        requestHighestRefreshRate();
    }

    /**
     * Fordert die höchste Bildwiederholrate des Displays an (z. B. 120 Hz),
     * bei gleicher Auflösung. Ohne das laufen WebView-Apps auf vielen Geräten
     * nur mit 60 Hz, was sich beim Scrollen ruckelig anfühlt.
     */
    @SuppressWarnings("deprecation")
    private void requestHighestRefreshRate() {
        try {
            Display display = getWindowManager().getDefaultDisplay();
            Display.Mode current = display.getMode();
            Display.Mode best = current;
            for (Display.Mode mode : display.getSupportedModes()) {
                boolean sameSize = mode.getPhysicalWidth() == current.getPhysicalWidth()
                    && mode.getPhysicalHeight() == current.getPhysicalHeight();
                if (sameSize && mode.getRefreshRate() > best.getRefreshRate()) {
                    best = mode;
                }
            }
            WindowManager.LayoutParams params = getWindow().getAttributes();
            if (params.preferredDisplayModeId != best.getModeId()) {
                params.preferredDisplayModeId = best.getModeId();
                params.preferredRefreshRate = best.getRefreshRate();
                getWindow().setAttributes(params);
            }
        } catch (Exception ignored) {
            // Kein Problem: dann bleibt die vom System gewählte Rate
        }
    }
}
