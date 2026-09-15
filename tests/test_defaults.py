import json
import unittest

from defaults import default_config, message_type_for_topic


class DefaultConfigTests(unittest.TestCase):
    def test_publish_payloads_are_valid_json(self):
        config = default_config()
        self.assertGreaterEqual(len(config["publishTopics"]), 10)
        for item in config["publishTopics"]:
            with self.subTest(topic=item["topic"]):
                json.loads(item["payload"])

    def test_topics_are_unique(self):
        config = default_config()
        publish = [item["topic"] for item in config["publishTopics"]]
        subscribe = [item["topic"] for item in config["subscriptions"]]
        self.assertEqual(len(publish), len(set(publish)))
        self.assertEqual(len(subscribe), len(set(subscribe)))

    def test_expected_agent_topics_are_present(self):
        subscriptions = {item["topic"] for item in default_config()["subscriptions"]}
        self.assertIn("missioncmd/status", subscriptions)
        self.assertIn("ads/agv/extra_info", subscriptions)
        self.assertIn("ads/toc/response", subscriptions)

    def test_default_publish_topics_have_message_types(self):
        config = default_config()
        expected = {
            "ads/toc/request": "AdsRequest",
            "missioncmd/request": "MissionCmdRequest",
            "localization/odom": "Odometry",
            "function_control/state": "FunctionState",
            "function_control/battery": "BatteryState",
            "support_fun_state": "SupportFun",
            "light_rain_sensor": "LightRainSensorInfo",
            "localplan_feedback": "TaskFeedback",
            "global/specialarea/request": "SpecialAreaRequest",
            "fcw_result": "FCWResult",
        }
        for item in config["publishTopics"]:
            self.assertEqual(item["messageType"], expected[item["topic"]])

    def test_message_type_falls_back_to_json_for_custom_topic(self):
        self.assertEqual(message_type_for_topic("custom/test/topic"), "JSON")


if __name__ == "__main__":
    unittest.main()
