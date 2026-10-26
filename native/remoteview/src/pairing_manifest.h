#ifndef REMOTEVIEW_PAIRING_MANIFEST_H
#define REMOTEVIEW_PAIRING_MANIFEST_H

/* Pairing manifest for the LG second-screen API (the register payload minus
 * the client-key field), embedded from lgtv2's pairing.json.
 * Source: https://raw.githubusercontent.com/hobbyquaker/lgtv2/master/pairing.json
 * Non-ASCII app names are written as JSON unicode escapes.
 *
 * lgtv2 is MIT licensed. Copyright (c) Sebastian Raff (hobbyquaker).
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated files, to deal in it without restriction,
 * subject to this copyright and permission notice being included in all copies
 * or substantial portions. PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. */
#define PAIRING_PAYLOAD_FIELDS \
    "\"forcePairing\":false,\"pairingType\":\"PROMPT\",\"manifest\":{\"manifestVersion\":1,\"ap" \
    "pVersion\":\"1.1\",\"signed\":{\"created\":\"20140509\",\"appId\":\"com.lge.test\",\"vendo" \
    "rId\":\"com.lge\",\"localizedAppNames\":{\"\":\"LG Remote App\",\"ko-KR\":\"\\ub9ac\\ubaa8" \
    "\\ucee8 \\uc571\",\"zxx-XX\":\"\\u041b\\u0413 R\\u044d\\u043cot\\u044d A\\u041f\\u041f\"}," \
    "\"localizedVendorNames\":{\"\":\"LG Electronics\"},\"permissions\":[\"TEST_SECURE\",\"CONT" \
    "ROL_INPUT_TEXT\",\"CONTROL_MOUSE_AND_KEYBOARD\",\"READ_INSTALLED_APPS\",\"READ_LGE_SDX\",\"" \
    "READ_NOTIFICATIONS\",\"SEARCH\",\"WRITE_SETTINGS\",\"WRITE_NOTIFICATION_ALERT\",\"CONTROL_" \
    "POWER\",\"READ_CURRENT_CHANNEL\",\"READ_RUNNING_APPS\",\"READ_UPDATE_INFO\",\"UPDATE_FROM_" \
    "REMOTE_APP\",\"READ_LGE_TV_INPUT_EVENTS\",\"READ_TV_CURRENT_TIME\"],\"serial\":\"2f930e2d2" \
    "cfe083771f68e4fe7bb07\"},\"permissions\":[\"LAUNCH\",\"LAUNCH_WEBAPP\",\"APP_TO_APP\",\"CL" \
    "OSE\",\"TEST_OPEN\",\"TEST_PROTECTED\",\"CONTROL_AUDIO\",\"CONTROL_DISPLAY\",\"CONTROL_INP" \
    "UT_JOYSTICK\",\"CONTROL_INPUT_MEDIA_RECORDING\",\"CONTROL_INPUT_MEDIA_PLAYBACK\",\"CONTROL" \
    "_INPUT_TV\",\"CONTROL_POWER\",\"READ_APP_STATUS\",\"READ_CURRENT_CHANNEL\",\"READ_INPUT_DE" \
    "VICE_LIST\",\"READ_NETWORK_STATE\",\"READ_RUNNING_APPS\",\"READ_TV_CHANNEL_LIST\",\"WRITE_" \
    "NOTIFICATION_TOAST\",\"READ_POWER_STATE\",\"READ_COUNTRY_INFO\",\"READ_SETTINGS\",\"CONTRO" \
    "L_TV_SCREEN\",\"CONTROL_TV_STANBY\",\"CONTROL_FAVORITE_GROUP\",\"CONTROL_USER_INFO\",\"CHE" \
    "CK_BLUETOOTH_DEVICE\",\"CONTROL_BLUETOOTH\",\"CONTROL_TIMER_INFO\",\"STB_INTERNAL_CONNECTI" \
    "ON\",\"CONTROL_RECORDING\",\"READ_RECORDING_STATE\",\"WRITE_RECORDING_LIST\",\"READ_RECORD" \
    "ING_LIST\",\"READ_RECORDING_SCHEDULE\",\"WRITE_RECORDING_SCHEDULE\",\"READ_STORAGE_DEVICE_" \
    "LIST\",\"READ_TV_PROGRAM_INFO\",\"CONTROL_BOX_CHANNEL\",\"READ_TV_ACR_AUTH_TOKEN\",\"READ_" \
    "TV_CONTENT_STATE\",\"READ_TV_CURRENT_TIME\",\"ADD_LAUNCHER_CHANNEL\",\"SET_CHANNEL_SKIP\"," \
    "\"RELEASE_CHANNEL_SKIP\",\"CONTROL_CHANNEL_BLOCK\",\"DELETE_SELECT_CHANNEL\",\"CONTROL_CHA" \
    "NNEL_GROUP\",\"SCAN_TV_CHANNELS\",\"CONTROL_TV_POWER\",\"CONTROL_WOL\"],\"signatures\":[{\"" \
    "signatureVersion\":1,\"signature\":\"eyJhbGdvcml0aG0iOiJSU0EtU0hBMjU2Iiwia2V5SWQiOiJ0ZXN0L" \
    "XNpZ25pbmctY2VydCIsInNpZ25hdHVyZVZlcnNpb24iOjF9.hrVRgjCwXVvE2OOSpDZ58hR+59aFNwYDyjQgKk3auu" \
    "kd7pcegmE2CzPCa0bJ0ZsRAcKkCTJrWo5iDzNhMBWRyaMOv5zWSrthlf7G128qvIlpMT0YNY+n/FaOHE73uLrS/g7s" \
    "wl3/qH/BGFG2Hu4RlL48eb3lLKqTt2xKHdCs6Cd4RMfJPYnzgvI4BNrFUKsjkcu+WD4OO2A27Pq1n50cMchmcaXadJ" \
    "hGrOqH5YmHdOCj5NSHzJYrsW0HPlpuAx/ECMeIZYDh6RMqaFM2DXzdKX9NmmyqzJ3o/0lkk/N97gfVRLW5hA29yeAw" \
    "aCViZNCP8iC9aO0q9fQojoa7NQnAtw==\"}]}"

#endif
