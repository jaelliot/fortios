//
//  AppLogger.swift
//
//  Centralized logging service using OSLog with privacy support.
//  Adapted from "The Overkill Logger" by Dimas Wisodewo.
//  Source: https://github.com/dimaswisodewo/The-Overkill-Logger
//
//  Usage:
//    AppLogger.info("App launched", category: "AppDelegate")
//    AppLogger.debug("User: \(id)", category: "WebBridge", privacy: .private)
//    AppLogger.error("Load failed", error: err, category: "SchemeHandler")
//

import Foundation
import OSLog

// MARK: - LogLevel

enum LogLevel: Int, Comparable {
    case verbose = 0
    case debug = 1
    case info = 2
    case warning = 3
    case error = 4

    var osLogType: OSLogType {
        switch self {
        case .verbose, .debug: return .debug
        case .info: return .info
        case .warning: return .default
        case .error: return .error
        }
    }

    var name: String {
        switch self {
        case .verbose: return "VERBOSE"
        case .debug: return "DEBUG"
        case .info: return "INFO"
        case .warning: return "WARNING"
        case .error: return "ERROR"
        }
    }

    static func < (lhs: LogLevel, rhs: LogLevel) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

// MARK: - LogPrivacy

enum LogPrivacy {
    /// Always visible in both Debug and Release builds.
    case `public`
    /// Redacted (`<private>`) in Release builds.
    case `private`
    /// Public in Debug, private in Release (default).
    case auto
    /// Always redacted — use for tokens, passwords, secrets.
    case sensitive
}

// MARK: - AppLogger

final class AppLogger {

    // MARK: Configuration

    private static let subsystem = AppConfig.Log.subsystem

    #if DEBUG
        private static let minimumLogLevel: LogLevel = .verbose
    #else
        private static let minimumLogLevel: LogLevel = .info
    #endif

    /// Lazily cached OSLog instances keyed by category string.
    private static var osLogCache: [String: OSLog] = [:]
    private static let cacheLock = NSLock()

    private init() {}

    // MARK: Private helpers

    private static func osLog(for category: String) -> OSLog {
        cacheLock.lock()
        defer { cacheLock.unlock() }
        if let cached = osLogCache[category] { return cached }
        let log = OSLog(subsystem: subsystem, category: category)
        osLogCache[category] = log
        return log
    }

    // MARK: Public API

    static func verbose(
        _ message: @autoclosure () -> String,
        category: String = AppConfig.Log.defaultCategory,
        privacy: LogPrivacy = .auto,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(
            level: .verbose, message: message(), category: category,
            privacy: privacy, file: file, function: function, line: line)
    }

    static func debug(
        _ message: @autoclosure () -> String,
        category: String = AppConfig.Log.defaultCategory,
        privacy: LogPrivacy = .auto,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(
            level: .debug, message: message(), category: category,
            privacy: privacy, file: file, function: function, line: line)
    }

    static func info(
        _ message: @autoclosure () -> String,
        category: String = AppConfig.Log.defaultCategory,
        privacy: LogPrivacy = .auto,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(
            level: .info, message: message(), category: category,
            privacy: privacy, file: file, function: function, line: line)
    }

    static func warning(
        _ message: @autoclosure () -> String,
        category: String = AppConfig.Log.defaultCategory,
        privacy: LogPrivacy = .auto,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        log(
            level: .warning, message: message(), category: category,
            privacy: privacy, file: file, function: function, line: line)
    }

    static func error(
        _ message: @autoclosure () -> String,
        error: Error? = nil,
        category: String = AppConfig.Log.defaultCategory,
        privacy: LogPrivacy = .auto,
        file: String = #file,
        function: String = #function,
        line: Int = #line
    ) {
        var fullMessage = message()
        if let error {
            fullMessage += " | Error: \(error.localizedDescription)"
        }
        log(
            level: .error, message: fullMessage, category: category,
            privacy: privacy, file: file, function: function, line: line)
    }

    // MARK: Core implementation

    // swiftlint:disable:next function_parameter_count
    private static func log(
        level: LogLevel,
        message: String,
        category: String,
        privacy: LogPrivacy,
        file: String,
        function: String,
        line: Int
    ) {
        guard level >= minimumLogLevel else { return }

        let formattedMessage: String
        #if DEBUG
            let timestamp = ISO8601DateFormatter().string(from: Date())
            let fileName = (file as NSString).lastPathComponent
            formattedMessage =
                "\(timestamp) \(level.name) [\(fileName):\(line)] \(function) > \(message)"
        #else
            formattedMessage = message
        #endif

        let logger = osLog(for: category)

        switch privacy {
        case .public:
            os_log("%{public}@", log: logger, type: level.osLogType, formattedMessage as NSString)
        case .private, .sensitive:
            os_log("%{private}@", log: logger, type: level.osLogType, formattedMessage as NSString)
        case .auto:
            #if DEBUG
                os_log(
                    "%{public}@", log: logger, type: level.osLogType, formattedMessage as NSString)
            #else
                os_log(
                    "%{private}@", log: logger, type: level.osLogType, formattedMessage as NSString)
            #endif
        }
    }
}
