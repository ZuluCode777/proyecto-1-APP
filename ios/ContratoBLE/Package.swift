// swift-tools-version:5.9
import PackageDescription

// Contrato BLE v1.0 del accesorio de proximidad (EA-04).
// ContratoBLE: decodificador y validación de sesión, solo con Foundation.
// ContratoBLEVectores: ejecutor de los vectores de contratos/ble/; solo para pruebas.
let package = Package(
    name: "ContratoBLE",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [
        .library(name: "ContratoBLE", targets: ["ContratoBLE"]),
        .library(name: "ContratoBLEVectores", targets: ["ContratoBLEVectores"]),
    ],
    targets: [
        .target(name: "ContratoBLE"),
        .target(name: "ContratoBLEVectores", dependencies: ["ContratoBLE"]),
        .testTarget(name: "ContratoBLETests", dependencies: ["ContratoBLE", "ContratoBLEVectores"]),
    ]
)
