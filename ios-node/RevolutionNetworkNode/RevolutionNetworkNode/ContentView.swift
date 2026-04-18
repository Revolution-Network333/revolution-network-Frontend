@"
import SwiftUI

// MARK: - Palette
private let BgDeep     = Color(red: 0.02, green: 0.02, blue: 0.02)
private let GreenNeon  = Color(red: 0, green: 1, blue: 0.616)
private let CyanNeon   = Color(red: 0, green: 0.953, blue: 1)
private let RedNeon    = Color(red: 1, green: 0.267, blue: 0.267)
private let TextMuted  = Color(red: 0.533, green: 0.533, blue: 0.533)
private let TextDim    = Color(red: 0.4, green: 0.4, blue: 0.4)
private let BorderCard = Color(red: 0.133, green: 0.133, blue: 0.133)
private let BgCard     = Color.white.opacity(0.03)
private let TerminalBg = Color.black
private let BASE_URL   = "https://revolution-backend-sal2.onrender.com"

// MARK: - Token Storage
class TokenStore: ObservableObject {
    @Published var token: String = ""
    private let key = "revolution_token"

    init() { token = UserDefaults.standard.string(forKey: key) ?? "" }

    func save(_ t: String) {
        token = t.trimmingCharacters(in: .whitespaces)
        UserDefaults.standard.set(token, forKey: key)
    }

    func clear() {
        token = ""
        UserDefaults.standard.removeObject(forKey: key)
    }

    var isLoggedIn: Bool { !token.isEmpty }
}

// MARK: - Node State
class NodeState: ObservableObject {
    @Published var running = false
    @Published var sessionPoints = 0
    @Published var hashrate: Double = 0
    @Published var logs: [String] = []
    @Published var sessionId: String? = nil

    func log(_ line: String) {
        DispatchQueue.main.async {
            self.logs.append(line)
            if self.logs.count > 120 { self.logs.removeFirst() }
        }
    }
}

// MARK: - Mining Engine
class MiningEngine: ObservableObject {
    private var task: Task<Void, Never>? = nil
    private let state: NodeState
    private let tokenStore: TokenStore

    init(state: NodeState, tokenStore: TokenStore) {
        self.state = state
        self.tokenStore = tokenStore
    }

    func start() {
        guard !state.running else { return }
        DispatchQueue.main.async { self.state.running = true; self.state.sessionPoints = 0 }
        state.log("[SYSTEM] Node starting...")

        task = Task.detached(priority: .background) { [weak self] in
            guard let self = self else { return }
            let token = self.tokenStore.token
            if token.isEmpty {
                self.state.log("[ERROR] No token. Please sign in.")
                DispatchQueue.main.async { self.state.running = false }
                return
            }

            // Create session
            guard let sessionId = await self.createSession(token: token) else {
                DispatchQueue.main.async { self.state.running = false }
                return
            }
            DispatchQueue.main.async { self.state.sessionId = sessionId }
            self.state.log("[SYSTEM] Session: \(sessionId)")

            var challenge = "revolution_network_challenge_\(Int(Date().timeIntervalSince1970 * 1000))"
            var nonce: Int64 = 0
            var points = 0
            var hashCount: Int64 = 0
            var lastRateTime = Date()
            var lastRateCount: Int64 = 0

            while !Task.isCancelled {
                let attempt = "\(challenge):\(nonce)"
                let hash = self.sha256(attempt)
                hashCount += 1

                if hash.hasPrefix("0000") {
                    self.state.log("[POW] Found: \(String(hash.prefix(8)))...")
                    if let pts = await self.submitProof(token: token, challenge: challenge, nonce: nonce, sessionId: sessionId) {
                        points += pts
                        DispatchQueue.main.async { self.state.sessionPoints = points }
                        self.state.log("[SERVER] Accepted +\(pts) pts")
                    }
                    challenge = "revolution_network_challenge_\(Int(Date().timeIntervalSince1970 * 1000))"
                    nonce = 0
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                } else {
                    nonce += 1
                    if nonce % 25_000 == 0 {
                        try? await Task.sleep(nanoseconds: 1_000_000)
                    }
                }

                let now = Date()
                if now.timeIntervalSince(lastRateTime) >= 1.5 {
                    let delta = hashCount - lastRateCount
                    let seconds = now.timeIntervalSince(lastRateTime)
                    let rate = Double(delta) / seconds
                    DispatchQueue.main.async { self.state.hashrate = rate }
                    lastRateTime = now
                    lastRateCount = hashCount
                }
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
        state.log("[SYSTEM] Stopping...")
        DispatchQueue.main.async {
            self.state.running = false
            self.state.hashrate = 0
        }
    }

    private func createSession(token: String) async -> String? {
        guard let url = URL(string: "\(BASE_URL)/api/session/create") else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.httpBody = "{}".data(using: .utf8)
        do {
            let (data, _) = try await URLSession.shared.data(for: req)
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            if let sid = json?["sessionId"] as? String { return sid }
        } catch {}
        state.log("[ERROR] Failed to create session")
        return nil
    }

    private func submitProof(token: String, challenge: String, nonce: Int64, sessionId: String) async -> Int? {
        guard let url = URL(string: "\(BASE_URL)/api/rewards/proof-of-work") else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let body: [String: Any] = ["challenge": challenge, "nonce": nonce, "sessionId": sessionId]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let (data, _) = try await URLSession.shared.data(for: req)
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            if json?["success"] as? Bool == true {
                return json?["points_earned"] as? Int ?? 0
            }
        } catch {}
        return nil
    }

    private func sha256(_ input: String) -> String {
        let data = Data(input.utf8)
        var digest = [UInt8](repeating: 0, count: 32)
        data.withUnsafeBytes { ptr in
            _ = CC_SHA256(ptr.baseAddress, CC_LONG(data.count), &digest)
        }
        return digest.map { String(format: "%02x", \$0) }.joined()
    }
}

// MARK: - Main App View
struct ContentView: View {
    @StateObject private var tokenStore = TokenStore()
    @StateObject private var nodeState = NodeState()

    var body: some View {
        ZStack {
            // Background
            RadialGradient(
                colors: [Color(red: 0.1, green: 0.1, blue: 0.1), BgDeep],
                center: .topLeading, startRadius: 0, endRadius: 800
            ).ignoresSafeArea()

            // Scanlines
            ScanlinesView().ignoresSafeArea()

            if !tokenStore.isLoggedIn {
                LoginView(tokenStore: tokenStore)
            } else {
                DashboardView(tokenStore: tokenStore, nodeState: nodeState)
            }
        }
    }
}

// MARK: - Scanlines
struct ScanlinesView: View {
    var body: some View {
        GeometryReader { geo in
            Canvas { ctx, size in
                var y: CGFloat = 0
                while y < size.height {
                    ctx.fill(Path(CGRect(x: 0, y: y + 2, width: size.width, height: 2)),
                             with: .color(Color.black.opacity(0.25)))
                    y += 4
                }
            }
        }
    }
}

// MARK: - Header
struct AppHeader: View {
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                ZStack {
                    Circle()
                        .fill(Color(red: 0.04, green: 0.04, blue: 0.04))
                        .frame(width: 32, height: 32)
                        .overlay(Circle().stroke(GreenNeon.opacity(0.6), lineWidth: 1))
                    Text("RN")
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundColor(GreenNeon)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text("REVOLUTION NETWORK")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(LinearGradient(
                            colors: [GreenNeon, CyanNeon],
                            startPoint: .leading, endPoint: .trailing
                        ))
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Color.black.opacity(0.5))

            // Glow line
            LinearGradient(
                colors: [.clear, GreenNeon.opacity(0.4), .clear],
                startPoint: .leading, endPoint: .trailing
            ).frame(height: 1)
        }
    }
}

// MARK: - Login
struct LoginView: View {
    @ObservedObject var tokenStore: TokenStore
    @State private var tokenInput = ""

    var body: some View {
        VStack(spacing: 0) {
            AppHeader()

            VStack(spacing: 24) {
                Text("Account Sign In")
                    .font(.system(size: 18, weight: .light))
                    .foregroundColor(.white)

                // Sign in button
                Button(action: {
                    if let url = URL(string: "https://revolution-network.fr/?desktop=true") {
                        UIApplication.shared.open(url)
                    }
                }) {
                    Text("SIGN IN VIA WEBSITE")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.black)
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                        .background(LinearGradient(
                            colors: [GreenNeon, Color(red: 0, green: 0.72, blue: 1)],
                            startPoint: .leading, endPoint: .trailing
                        ))
                        .cornerRadius(4)
                }

                // Token paste
                VStack(spacing: 8) {
                    TextField("Paste your token here", text: \$tokenInput)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(.white)
                        .padding(10)
                        .background(Color.white.opacity(0.05))
                        .cornerRadius(4)
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(BorderCard))

                    Button("SAVE TOKEN") {
                        if !tokenInput.isEmpty {
                            tokenStore.save(tokenInput)
                        }
                    }
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(.black)
                    .frame(maxWidth: .infinity)
                    .frame(height: 40)
                    .background(GreenNeon)
                    .cornerRadius(4)
                }
            }
            .padding(20)
            Spacer()
        }
    }
}

// MARK: - Dashboard
struct DashboardView: View {
    @ObservedObject var tokenStore: TokenStore
    @ObservedObject var nodeState: NodeState
    @StateObject private var engine: MiningEngine

    init(tokenStore: TokenStore, nodeState: NodeState) {
        self.tokenStore = tokenStore
        self.nodeState = nodeState
        _engine = StateObject(wrappedValue: MiningEngine(state: nodeState, tokenStore: tokenStore))
    }

    var body: some View {
        VStack(spacing: 0) {
            AppHeader()

            ScrollView {
                VStack(spacing: 16) {
                    // Status + Points row
                    HStack(spacing: 12) {
                        NodeStatusCard(running: nodeState.running)
                        PointsCard(points: nodeState.sessionPoints, hashrate: nodeState.hashrate)
                    }

                    // Terminal
                    TerminalCard(logs: nodeState.logs)

                    // Control button
                    ControlButton(running: nodeState.running) {
                        if nodeState.running { engine.stop() } else { engine.start() }
                    }

                    // Footer
                    FooterView(tokenStore: tokenStore)
                }
                .padding(16)
            }
        }
    }
}

// MARK: - NeonCard
struct NeonCard<Content: View>: View {
    let content: () -> Content
    var body: some View {
        ZStack(alignment: .top) {
            VStack(content: content)
                .frame(maxWidth: .infinity)
                .padding(14)
                .background(BgCard)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(BorderCard, lineWidth: 1))
                .cornerRadius(8)

            LinearGradient(
                colors: [.clear, GreenNeon.opacity(0.5), .clear],
                startPoint: .leading, endPoint: .trailing
            ).frame(height: 2).cornerRadius(8)
        }
    }
}

// MARK: - Node Status Card
struct NodeStatusCard: View {
    let running: Bool
    @State private var dotAlpha: Double = 0.5

    var body: some View {
        NeonCard {
            Text("NODE STATUS")
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(TextMuted)
                .padding(.bottom, 10)

            HStack(spacing: 8) {
                let color = running ? GreenNeon : RedNeon
                Circle()
                    .fill(color.opacity(running ? dotAlpha : 1))
                    .frame(width: 10, height: 10)
                    .shadow(color: color.opacity(0.5), radius: 6)

                Text(running ? "ACTIVE" : "INACTIVE")
                    .font(.system(size: 13, weight: .bold, design: .monospaced))
                    .foregroundColor(running ? GreenNeon : RedNeon)
            }
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                dotAlpha = 1.0
            }
        }
    }
}

// MARK: - Points Card
struct PointsCard: View {
    let points: Int
    let hashrate: Double

    var body: some View {
        NeonCard {
            Text("POINTS (SESSION)")
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(TextMuted)
                .padding(.bottom, 8)

            Text("\(points)")
                .font(.system(size: 28, weight: .bold, design: .monospaced))
                .foregroundColor(.white)

            Text("\(Int(hashrate)) H/s")
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(TextDim)
        }
    }
}

// MARK: - Terminal Card
struct TerminalCard: View {
    let logs: [String]

    var body: some View {
        ZStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 8) {
                Text("HASHRATE / LOGS")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(TextMuted)

                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 2) {
                            if logs.isEmpty {
                                Text("[SYSTEM] Ready to mine...")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundColor(GreenNeon.opacity(0.8))
                            } else {
                                ForEach(Array(logs.suffix(50).enumerated()), id: \.offset) { _, log in
                                    Text(log)
                                        .font(.system(size: 10, design: .monospaced))
                                        .foregroundColor(GreenNeon.opacity(0.9))
                                        .lineLimit(1)
                                        .id(log)
                                }
                            }
                        }
                        .padding(8)
                    }
                    .onChange(of: logs.count) { _ in
                        if let last = logs.last {
                            proxy.scrollTo(last, anchor: .bottom)
                        }
                    }
                }
                .frame(height: 110)
                .background(TerminalBg)
                .cornerRadius(4)
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(white: 0.2), lineWidth: 1))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(BgCard)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(BorderCard, lineWidth: 1))
            .cornerRadius(8)

            LinearGradient(
                colors: [.clear, GreenNeon.opacity(0.5), .clear],
                startPoint: .leading, endPoint: .trailing
            ).frame(height: 2).cornerRadius(8)
        }
    }
}

// MARK: - Control Button
struct ControlButton: View {
    let running: Bool
    let action: () -> Void
    @State private var glowAlpha: Double = 0.15

    var body: some View {
        let color = running ? RedNeon : GreenNeon
        Button(action: action) {
            ZStack {
                Circle()
                    .fill(RadialGradient(
                        colors: [color.opacity(glowAlpha), Color.black.opacity(0.6)],
                        center: .center, startRadius: 0, endRadius: 40
                    ))
                    .frame(width: 72, height: 72)
                    .overlay(Circle().stroke(color, lineWidth: 2))

                if running {
                    HStack(spacing: 6) {
                        Rectangle().fill(color).frame(width: 5, height: 22)
                        Rectangle().fill(color).frame(width: 5, height: 22)
                    }
                } else {
                    Text("▶")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundColor(color)
                }
            }
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) {
                glowAlpha = 0.35
            }
        }
    }
}

// MARK: - Footer
struct FooterView: View {
    @ObservedObject var tokenStore: TokenStore

    var body: some View {
        VStack(spacing: 12) {
            Rectangle().fill(BorderCard).frame(height: 1)

            HStack {
                Button("Sign out") { tokenStore.clear() }
                    .font(.system(size: 12))
                    .foregroundColor(TextMuted)

                Spacer()

                Button("Web Dashboard >>") {
                    if let url = URL(string: "https://revolution-network.fr/") {
                        UIApplication.shared.open(url)
                    }
                }
                .font(.system(size: 12))
                .foregroundColor(TextMuted)
            }
        }
    }
}
"@ | Out-File -Encoding utf8 "ios-node\RevolutionNetworkNode\RevolutionNetworkNode\ContentView.swift"