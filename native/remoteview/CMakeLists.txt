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
else()
  add_executable(remoteview src/main.c src/keymap.c src/pointer.c src/uinput.c)
  target_compile_definitions(remoteview PRIVATE REMOTEVIEW_VERSION="${REMOTEVIEW_VERSION}")
endif()
