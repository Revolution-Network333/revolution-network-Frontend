import SwiftUI

struct ContentView: View {
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 20) {
                Image(systemName: "network")
                    .font(.system(size: 60))
                    .foregroundColor(.green)
                Text("Revolution Network Node")
                    .font(.title)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                Text("Node actif ✅")
                    .foregroundColor(.gray)
            }
        }
    }
}
