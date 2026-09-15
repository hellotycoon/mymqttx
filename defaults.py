"""Built-in topics derived from the scripts and agent.yaml in the source workspace."""

from __future__ import annotations

import json
import socket
import time
import uuid


TOPIC_MESSAGE_TYPES = {
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


def message_type_for_topic(topic: str) -> str:
    return TOPIC_MESSAGE_TYPES.get(topic.strip(), "JSON")


def _pretty(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


def default_publish_topics() -> list[dict]:
    timestamp_ns = time.time_ns()
    timestamp_sec = int(time.time())
    mission_body = {
        "task_id": "test-task-001",
        "map_firmware_id": "0",
        "destination": {
            "locationId": "StagingArea",
            "locationType": "PARK",
            "description": "manual agent test",
            "x": 1.0,
            "y": 0.0,
            "theta": 0.0,
        },
        "global_destination": {"id": 0, "s": 0.0, "x": 1.0, "y": 0.0, "theta": 0.0},
        "navi_task_type": 0,
        "backward_motion": False,
        "isFinalNavi": True,
        "route_waypoints": [
            {"node_index": 0, "s": 0.0, "x": 0.0, "y": 0.0, "theta": 0.0},
            {"node_index": 1, "s": 1.0, "x": 1.0, "y": 0.0, "theta": 0.0},
        ],
        "lane_sequence": [],
        "global_lane_sequence": [],
        "command_reference_lines": [],
    }
    entries = [
        (
            "ads/toc/request",
            {"request_id": 10001, "request_type": 0, "ts": timestamp_sec, "body": "{}"},
        ),
        (
            "missioncmd/request",
            {
                "header": {"transId": "test-navi-001", "timestamp": str(timestamp_ns)},
                "type": 2,
                "body": json.dumps(mission_body, ensure_ascii=False, indent=2),
            },
        ),
        (
            "localization/odom",
            {
                "header": {"timestamp_ns": timestamp_ns},
                "pose": {
                    "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "orientation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
                },
                "vel": {
                    "linear": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "angular": {"x": 0.0, "y": 0.0, "z": 0.0},
                },
            },
        ),
        (
            "function_control/state",
            {
                "header": {"timestamp_ns": timestamp_ns},
                "chassis_status": {
                    "heartbeat": 0,
                    "motion_mode": 0,
                    "chassis_mode": 2,
                    "power": True,
                    "ctrl": True,
                    "parking": False,
                    "estop": False,
                    "chassis_ready": True,
                    "chassis_allow_enter_auto_sts": True,
                    "estop_button_sts": False,
                    "mode_button_sts": False,
                    "collision_sts": False,
                    "abnormal_request_slow_down": False,
                    "acc_pedal_pos": 0,
                    "brake_pedal_pos": 0,
                    "bypass_sts": False,
                    "left_park_sw_sts": False,
                    "right_park_sw_sts": False,
                    "hand_rc_estop_ctl": False,
                    "net_rc_estop_ctl": False,
                    "park_manual_sts": False,
                    "shift_manual_sts": False,
                    "steer_manual_sts": False,
                    "brake_pedal_sts": False,
                    "acc_pedal_sts": False,
                    "lidar_trigger": False,
                    "ultrasonic_trigger": False,
                    "reverse_ultrasonic_trigger": False,
                    "chassis_speed_abnormal_sts": False,
                    "steer_release_sts": False,
                    "vehicle_id": 1,
                    "truck_load_kg": 0,
                    "air_condition_sts": False,
                    "chassis_snow_mode_sts": False,
                    "cabin_temperature": 25,
                    "abs_active": False,
                    "rear_left_park_sw_sts": False,
                    "rear_right_park_sw_sts": False,
                },
                "battery_swap": {
                    "swap_sts": 0,
                    "swap_arrive": False,
                    "swap_net": 0,
                    "verify_vehicle": False,
                    "swap_door": False,
                    "rgv_sts": 0,
                    "swap_lift": 0,
                    "swap_vehicle_pos": 0,
                    "available_swap_staion": 0,
                    "charge_door_sts": 0,
                    "charge_unit_sts": 0,
                    "allow_swap_sts": False,
                    "swap_lock_sts": False,
                },
                "enable_state": {
                    "lon_en": True,
                    "lat_en": True,
                    "gear_en": True,
                    "brake_en": True,
                    "bcm_en": True,
                    "sprd_en": False,
                    "hoist_en": False,
                    "hydr_en": False,
                },
                "gear": {"tcu_shift_flag": False, "gear": 0, "gear_num": 0},
                "bcm": {
                    "beam_sts": 2,
                    "turn_signal_sts": 0,
                    "fog_light_sts": 0,
                    "compensate_lamp_sts": 0,
                    "lock_lamp_sts": 0,
                    "match_pos_lamp_sts": 0,
                    "hazard_warning_lamp_sts": 0,
                    "brake_lamp_sts": 0,
                    "reverse_lamp_sts": 0,
                    "clearance_lamp_sts": 0,
                    "front_daytime_running_lamp_sts": 0,
                    "rear_daytime_running_lamp_sts": 0,
                    "horn_sts": 0,
                    "left_door_sts": 0,
                    "right_door_sts": 0,
                },
                "coupling": {
                    "traction_bolt_sts": 0,
                    "traction_bolt_seat_sts": 0,
                    "vehicle_allow_move_sts": 1,
                    "couple_response": 0,
                    "coupling_state": 0,
                    "decoupling_state": 0,
                    "coupling_in_back_pos": False,
                    "coupling_in_front_pos": False,
                    "chassis_trailer_available": False,
                    "trailer_battery_sts": 0,
                    "couple_fault_code": 0,
                    "trailer_id": 0,
                    "trailer_types": [],
                    "front_container_pos_sts": False,
                    "rear_container_pos_sts": False,
                },
                "chassis_fault": {
                    "system_fault_code": 0,
                    "system_fault_level": 0,
                    "hand_remote_fault_code": 0,
                    "net_remote_fault_code": 0,
                    "new_fault_code": 0,
                    "new_fault_level": 0,
                },
                "support": {
                    "mileage_duration": 0.0,
                    "mileage_distance": 0.0,
                    "power_on_time": 0.0,
                    "chassis_version": "test",
                },
            },
        ),
        (
            "function_control/battery",
            {
                "header": {"timestamp_ns": timestamp_ns},
                "soc": 80.0,
                "soh": 95.0,
                "bms_voltage": 700.0,
                "bms_current": 0.0,
                "temperature": 25,
                "charge_status": 0,
                "dc_charge_connect_sts": 0,
                "ac_charge_connect_sts": 0,
                "min_single_voltage": 3.2,
                "max_single_voltage": 3.4,
                "battery_packages_num": 1,
                "battery_packages_sn": "TEST-BATTERY-001",
                "accumulated_charge_capacity": 0,
                "accumulated_discharge_capacity": 0,
            },
        ),
        (
            "support_fun_state",
            {
                "header": {"timestamp_ns": timestamp_ns},
                "front_stage_up_ok": False,
                "front_stage_down_ok": True,
                "rear_stage_up_ok": False,
                "rear_stage_down_ok": True,
                "allow_front_stage_up_sts": True,
                "allow_rear_stage_up_sts": True,
                "forbidden_lift_sts": False,
                "container_mode": 0,
                "charge_door_state": 0,
                "slow_running_lamp_sts": False,
                "slow_running_trigger": False,
                "camera_arm_pos_ok": True,
                "camera_arm_error": 0,
                "left_camera_arm_pos": 0,
                "right_camera_arm_pos": 0,
                "chassis_allow_request_auto": True,
                "wvin_code": "TEST-WVIN",
            },
        ),
        (
            "light_rain_sensor",
            {
                "timestamp_ns": timestamp_ns,
                "sensor_status": 0,
                "rain_gear": 0,
                "light_sensor_request_on": False,
            },
        ),
        (
            "localplan_feedback",
            {
                "trans_id": "test-navi-001",
                "task_status": 0,
                "speed": 0.0,
                "distance_to_goal": 0.3,
                "distance_to_obstacle": -999.0,
                "distance_to_stop_line": 0.0,
                "expected_time_remaining": 0.0,
                "collision_point": {"x": 0.0, "y": 0.0},
                "head_pose_at_collision": {"x": 0.0, "y": 0.0},
                "heading_at_collision": 0.0,
                "head_pose_at_stop_line": {"x": 0.0, "y": 0.0},
                "heading_at_stop_line": 0.0,
                "collision_type": 0,
                "lateral_deviation_m": 0.0,
                "chosen_reference": [],
                "maneuver_upstream": 0,
                "reference_line_speed_limit_mps": -1.0,
            },
        ),
        (
            "global/specialarea/request",
            {
                "header": {"transId": "test-special-area-001", "timestamp": str(timestamp_ns)},
                "body": {
                    "WorkArea": [
                        [
                            {"x": 0.0, "y": 0.0},
                            {"x": 10.0, "y": 0.0},
                            {"x": 10.0, "y": 10.0},
                            {"x": 0.0, "y": 10.0},
                        ]
                    ],
                    "SecAreaStop": [],
                    "SecAreaNoStop": [],
                },
            },
        ),
        (
            "fcw_result",
            {
                "header": {"timestamp_ns": timestamp_ns},
                "valid": True,
                "status": 0,
                "fcw_vehicle_warning_status": 0,
                "pcw_pedestrian_warning_status": 0,
                "threat_object_id": -1,
                "threat_ttc_s": 0.0,
                "threat_dist_long_m": 0.0,
                "threat_dist_lat_m": 0.0,
                "threat_rel_speed_mps": 0.0,
                "ped_ttc_s": 0.0,
                "ped_dist_long_m": 0.0,
                "ped_dist_lat_m": 0.0,
                "ped_rel_speed_mps": 0.0,
                "obs_ttc_s": 0.0,
                "obs_dist_long_m": 0.0,
                "obs_dist_lat_m": 0.0,
                "obs_rel_speed_mps": 0.0,
            },
        ),
    ]
    return [
        {
            "id": uuid.uuid4().hex,
            "topic": topic,
            "messageType": message_type_for_topic(topic),
            "payload": _pretty(payload),
            "qos": 0,
            "retain": False,
            "intervalMs": 0,
        }
        for topic, payload in entries
    ]


def default_subscriptions() -> list[dict]:
    # MQTT outputs from the "pub agent" section of agent.yaml.
    topics = [
        "missioncmd/status",
        "devicetask/mission/response",
        "bsm/request",
        "bms/notify",
        "login/request",
        "detectioninfo/request",
        "qpilot/perception/obstacles",
        "bypass_set_code",
        "bypass_remove_code",
        "bypass_set_navi_code",
        "bcm_cmd",
        "ads/mission/info",
        "ads/mission/task/navigation",
        "ads/toc/response",
        "ads/vehicle_state",
        "ads/agv/extra_info",
        "ads/mission/task/alignment",
    ]
    # Preloaded topics are only suggestions. The user must explicitly enable
    # one before the client subscribes and starts receiving Agent traffic.
    return [{"id": uuid.uuid4().hex, "topic": topic, "qos": 0, "enabled": False} for topic in topics]


def default_config() -> dict:
    suffix = uuid.uuid4().hex[:6]
    hostname = socket.gethostname().split(".")[0][:16]
    return {
        "version": 2,
        "broker": {
            "host": "127.0.0.1",
            "port": 1883,
            "clientId": f"mymqttx-{hostname}-{suffix}",
            "username": "",
            "password": "",
            "keepalive": 60,
            "cleanSession": True,
        },
        "publishTopics": default_publish_topics(),
        "subscriptions": default_subscriptions(),
    }
