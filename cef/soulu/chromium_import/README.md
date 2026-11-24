Chromium 156.0.8078.96, components/password_manager/core/browser/import.
CSVFieldParser and ConsumeCSVLine come from csv_field_parser.{h,cc} and csv_password_iterator.cc in the official Chromium source tree. Standalone CEF build adaptations replace Chromium debug assertions, string prefix checks and stack allocation annotations. License included.

The bookmark HTML adapter uses the attribute extraction from
components/user_data_importer/content/content_bookmark_parser_utils.cc and
adapts the Netscape bookmark hierarchy to Sona's bookmark nodes. Session
commands follow components/sessions/core/command_storage_backend.cc and
session_service_commands.cc, including Chromium's navigation pruning and
closest-navigation selection. The CEF adapter exposes only the selected URLs
and rejects encrypted or unsupported session versions.
