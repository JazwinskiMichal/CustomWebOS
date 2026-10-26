cmake_minimum_required(VERSION 3.16)
project(remoteview C)

set(REMOTEVIEW_VERSION "0.1.0")
set(CMAKE_C_STANDARD 99)

option(REMOTEVIEW_HOST_TESTS "Build only pure sources and unit tests with the host compiler" OFF)

if(REMOTEVIEW_HOST_TESTS)
  enable_testing()
  add_executable(test_smoke test/test_smoke.c)
  add_test(NAME test_smoke COMMAND test_smoke)
else()
  add_executable(remoteview src/main.c)
  target_compile_definitions(remoteview PRIVATE REMOTEVIEW_VERSION="${REMOTEVIEW_VERSION}")
endif()
