import { describe, expect, it } from "vitest";
import { prfFromCapabilities } from "./capabilities";

describe("prfFromCapabilities", () => {
  it("trusts an explicit answer", () => {
    expect(prfFromCapabilities({ "extension:prf": true })).toBe("yes");
    expect(prfFromCapabilities({ "extension:prf": false })).toBe("no");
  });
  it("treats no platform authenticator as no", () => {
    expect(prfFromCapabilities({ passkeyPlatformAuthenticator: false })).toBe("no");
  });
  it("is unknown when the browser does not say, so the flow still tries", () => {
    expect(prfFromCapabilities({ conditionalGet: true })).toBe("unknown");
    expect(prfFromCapabilities(null)).toBe("unknown");
  });
});
