import { NextRequest, NextResponse } from "next/server";
import {
  isOpAuthenticated,
  readExpectedVars,
  checkVaultItem,
  createVaultItem,
  populateEnvLocal,
} from "@/lib/onepassword";

const VAULT_NAME = "Cascade";

export async function GET(request: NextRequest) {
  try {
    const projectPath = request.nextUrl.searchParams.get("path");
    const projectName = request.nextUrl.searchParams.get("name");

    if (!projectPath || !projectName) {
      return NextResponse.json(
        { error: "path and name params required" },
        { status: 400 }
      );
    }

    if (!isOpAuthenticated()) {
      return NextResponse.json(
        { error: "1Password CLI not authenticated", authenticated: false },
        { status: 401 }
      );
    }

    const expectedVars = await readExpectedVars(projectPath);
    const status = checkVaultItem(VAULT_NAME, projectName, expectedVars);

    return NextResponse.json({ authenticated: true, vars: status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, projectPath, projectName, vars } = body;

    if (!isOpAuthenticated()) {
      return NextResponse.json(
        { error: "1Password CLI not authenticated" },
        { status: 401 }
      );
    }

    if (action === "create") {
      const result = createVaultItem(
        VAULT_NAME,
        projectName,
        vars || {}
      );
      return NextResponse.json(result);
    }

    if (action === "populate") {
      const expectedVars = await readExpectedVars(projectPath);
      const result = await populateEnvLocal(
        projectPath,
        VAULT_NAME,
        projectName,
        expectedVars
      );
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: "Invalid action. Use 'create' or 'populate'" },
      { status: 400 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
