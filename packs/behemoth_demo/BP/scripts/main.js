// Behemoth demo boss pack: hands its boss configs to the Behemoth framework.
// That's all a boss pack's script needs — the framework does the rest.
import { connect } from "./behemoth/connector.js";
import bosses from "./bosses/index.js";

connect({ pack: "behemoth_demo", version: "0.6.0", minFramework: "0.6.0", bosses });
