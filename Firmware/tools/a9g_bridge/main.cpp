/**
 * A9G bench hunter — diagnostic build, not part of the product firmware.
 *
 *   pio run -e a9gbridge -t upload
 *   pio device monitor --port COM8
 *
 * Cycles every plausible baud rate AND both pin orientations, sending AT and
 * listening. Prints anything that comes back with a readability score, so a
 * spontaneous burst from the module gets caught at whichever rate is correct.
 *
 * Press the A9G's PWR button for 3 s first — the module does not boot on power
 * alone, and a board with a lit LED can still have a sleeping modem.
 */
#include <Arduino.h>

#define PIN_A  17
#define PIN_B  18

// 921600 / 1000000 are the A9G DEBUG uart's usual rates. Readable text there
// means you are on the debug pins and must move to the AT pins.
static const uint32_t BAUDS[] = {
    115200, 921600, 1000000, 460800, 230400, 57600, 38400, 19200, 9600, 4800
};
static const size_t NBAUD = sizeof(BAUDS) / sizeof(BAUDS[0]);

static void dump(const String& s) {
    int printable = 0;
    for (size_t i = 0; i < s.length(); i++)
        if ((s[i] >= 32 && s[i] < 127) || s[i] == '\n' || s[i] == '\r') printable++;
    int pct = s.length() ? (int)(100L * printable / s.length()) : 0;

    Serial.printf("%3d bytes %3d%% readable | ", s.length(), pct);
    for (size_t i = 0; i < s.length() && i < 60; i++) {
        char c = s[i];
        Serial.print((c >= 32 && c < 127) ? c : '.');
    }
    if (pct >= 80) Serial.print("   <<<< READABLE");
    Serial.println();
}

// Returns: 2 = got OK, 1 = got bytes, 0 = silence
static int trial(uint32_t baud, int rxPin, int txPin) {
    Serial1.begin(baud, SERIAL_8N1, rxPin, txPin);
    delay(60);
    while (Serial1.available()) Serial1.read();

    // Listen first (catches unsolicited output), then poke it.
    String heard;
    uint32_t deadline = millis() + 700;
    while (millis() < deadline) while (Serial1.available()) heard += (char)Serial1.read();

    Serial1.print("AT\r\n");
    deadline = millis() + 700;
    while (millis() < deadline) while (Serial1.available()) heard += (char)Serial1.read();

    Serial1.end();

    if (heard.indexOf("OK") >= 0) {
        Serial.printf("  baud %7lu  RX=%d TX=%d  *** OK *** ", (unsigned long)baud, rxPin, txPin);
        dump(heard);
        return 2;
    }
    if (heard.length() >= 2) {
        Serial.printf("  baud %7lu  RX=%d TX=%d  ", (unsigned long)baud, rxPin, txPin);
        dump(heard);
        return 1;
    }
    return 0;
}

void setup() {
    Serial.begin(115200);
    uint32_t t0 = millis();
    while (!Serial && millis() - t0 < 2000) delay(10);

    Serial.println("\n=== A9G hunter ===");
    Serial.println("Make sure you held the A9G PWR button for 3 s and TWO LEDs are lit.");
    Serial.println("Silence is skipped; only responses are printed.\n");
}

void loop() {
    static uint32_t round = 0;
    Serial.printf("--- round %lu ---\n", (unsigned long)++round);

    bool anything = false;
    for (size_t i = 0; i < NBAUD; i++) {
        // Try the wiring both ways round — a reversed TX/RX pair is silent,
        // and it is not obvious from the outside which way you have it.
        if (trial(BAUDS[i], PIN_A, PIN_B)) anything = true;
        if (trial(BAUDS[i], PIN_B, PIN_A)) anything = true;
    }

    if (!anything) {
        Serial.println("  (nothing on any baud, either orientation)");
        Serial.println("  -> module asleep (hold PWR 3 s), no shared GND, or wrong pin pair");
    }
    Serial.println();
    delay(1500);
}
