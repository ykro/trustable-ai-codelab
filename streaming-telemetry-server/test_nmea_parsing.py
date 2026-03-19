import sys
import os
import unittest

# Add current directory to sys.path so we can import ingest
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from ingest import parse_nmea_sentence

class TestNMEAParsing(unittest.TestCase):
    def test_gprmc(self):
        # Example GPRMC sentence
        # $GPRMC,220516,A,5133.82,N,00042.24,W,173.8,231.8,130694,004.2,W*70
        line = "$GPRMC,220516,A,5133.82,N,00042.24,W,173.8,231.8,130694,004.2,W*70"
        result = parse_nmea_sentence(line)
        self.assertIsNotNone(result)
        self.assertEqual(result["type"], "gps")
        # 5133.82 N -> 51 + 33.82/60 = 51.563666...
        self.assertAlmostEqual(result["lat"], 51.56366666666667, places=5)
        # 00042.24 W -> -(0 + 42.24/60) = -0.704
        self.assertAlmostEqual(result["lon"], -0.704, places=5)
        # Speed 173.8 knots -> 173.8 * 1.852 km/h
        self.assertAlmostEqual(result["speed"], 173.8 * 1.852, places=2)
        self.assertAlmostEqual(result["heading"], 231.8)

    def test_gpgga(self):
        # Example GPGGA sentence
        # $GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47
        line = "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47"
        result = parse_nmea_sentence(line)
        self.assertIsNotNone(result)
        self.assertAlmostEqual(result["lat"], 48.1173, places=4)
        self.assertAlmostEqual(result["lon"], 11.51666, places=4)
        # GGA doesn't have speed/course, so defaults to 0.0
        self.assertEqual(result["speed"], 0.0)
        self.assertEqual(result["heading"], 0.0)

    def test_invalid(self):
        line = "$GPZZZ,INVALID"
        result = parse_nmea_sentence(line)
        self.assertIsNone(result)

    def test_bad_checksum(self):
        # Valid sentence with wrong checksum
        line = "$GPRMC,220516,A,5133.82,N,00042.24,W,173.8,231.8,130694,004.2,W*00"
        result = parse_nmea_sentence(line)
        self.assertIsNone(result)

if __name__ == '__main__':
    unittest.main()
