cmake_minimum_required(VERSION 3.16)
project(remoteview C)

set(REMOTEVIEW_VERSION "0.1.0")
set(CMAKE_C_STANDARD 99)

option(REMOTEVIEW_HOST_TESTS "Build only pure sources and unit tests with the host compiler" OFF)

if(REMOTEVIEW_HOST_TESTS)
  enable_testing()
  # Tests rely on assert(); make sure it can never be compiled out.
  add_compile_options(-UNDEBUG)
  add_executable(test_smoke test/test_smoke.c)
  add_test(NAME test_smoke COMMAND test_smoke)
  add_executable(test_keymap test/test_keymap.c src/keymap.c)
  add_test(NAME test_keymap COMMAND test_keymap)
  add_executable(test_pointer test/test_pointer.c src/pointer.c)
  add_test(NAME test_pointer COMMAND test_pointer)
  add_executable(test_ws test/test_ws.c src/ws.c)
  add_test(NAME test_ws COMMAND test_ws)
  add_executable(test_ssap test/test_ssap.c src/ssap.c)
  add_test(NAME test_ssap COMMAND test_ssap)
  add_executable(test_shutdown test/test_shutdown.c src/shutdown.c)
  add_test(NAME test_shutdown COMMAND test_shutdown)
  add_executable(test_session test/test_session.c src/session.c)
  add_test(NAME test_session COMMAND test_session)
  add_executable(test_lanfilter test/test_lanfilter.c src/lanfilter.c)
  add_test(NAME test_lanfilter COMMAND test_lanfilter)
  add_executable(test_config test/test_config.c src/config.c)
  add_test(NAME test_config COMMAND test_config)
  add_executable(test_governor test/test_governor.c src/governor.c)
  add_test(NAME test_governor COMMAND test_governor)
  add_executable(test_cpustat test/test_cpustat.c src/cpustat.c)
  add_test(NAME test_cpustat COMMAND test_cpustat)
  add_executable(test_toast test/test_toast.c src/toast.c)
  target_link_libraries(test_toast pthread)
  add_test(NAME test_toast COMMAND test_toast)
else()
  # Capture comes from hyperion-webos' unicapture and its two backends; the
  # flatbuffers/hyperion client parts of that project are not built.
  set(HW ${CMAKE_CURRENT_SOURCE_DIR}/third_party/hyperion-webos)
  set(NEON_FLAGS -mcpu=cortex-a9 -mfloat-abi=softfp -mfpu=neon)
  add_compile_options(${NEON_FLAGS})
  add_compile_definitions(SECURITY_COMPATIBILITY)
  add_subdirectory(${HW}/libyuv libyuv)
  add_subdirectory(${HW}/tv-native-apis tv-native-apis)

  find_package(PkgConfig REQUIRED)
  pkg_check_modules(PMLOG REQUIRED PmLogLib)

  add_executable(remoteview src/main.c src/keymap.c src/pointer.c src/ws.c src/ssap.c src/lginput.c
    src/shutdown.c src/capture.c src/session.c src/lanfilter.c src/config.c src/governor.c src/cpustat.c src/toast.c src/server.c
    ${HW}/src/unicapture.c ${HW}/src/converter.c ${HW}/src/log.c ${HW}/src/utils.c)
  target_compile_definitions(remoteview PRIVATE REMOTEVIEW_VERSION="${REMOTEVIEW_VERSION}")
  set(LIBVNC_ROOT /opt/libvnc CACHE PATH "Static LibVNCServer install (see Dockerfile)")
  target_include_directories(remoteview PRIVATE ${HW}/src ${PMLOG_INCLUDE_DIRS} ${LIBVNC_ROOT}/include)
  target_link_libraries(remoteview ${LIBVNC_ROOT}/lib/libvncserver.a jpeg z yuv dl pthread rt ${PMLOG_LDFLAGS})
  # The backends call log_printf/getticks_us from the executable.
  set_target_properties(remoteview PROPERTIES ENABLE_EXPORTS ON)
  # Ship libjpeg.so.8 beside the binary (the TV only has .so.62).
  set_target_properties(remoteview PROPERTIES BUILD_RPATH "\$ORIGIN" INSTALL_RPATH "\$ORIGIN")

  add_library(gm_backend SHARED ${HW}/src/backends/libgm.c)
  target_include_directories(gm_backend PRIVATE ${HW}/src ${HW}/src/backends)
  target_link_libraries(gm_backend gm)

  # Our copy of libdile_vt.c: its cleanup also unmaps the frame buffers and
  # closes /dev/mem (upstream leaks both on every capture session).
  add_library(dile_vt_backend SHARED backends/libdile_vt.c)
  target_include_directories(dile_vt_backend PRIVATE ${HW}/src ${HW}/src/backends)
  # libdile_vt.so lacks DT_NEEDED for PmLogLib.
  target_link_libraries(dile_vt_backend dile_vt)
  set_target_properties(dile_vt_backend PROPERTIES LINK_FLAGS "-lPmLogLib")
endif()
