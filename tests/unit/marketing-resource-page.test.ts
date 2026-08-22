import { NextRequest, NextResponse } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { refreshSupabaseAuthMock } = vi.hoisted(() => ({
  refreshSupabaseAuthMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/proxy", () => ({
  refreshSupabaseAuth: refreshSupabaseAuthMock,
}));

import { MARKETING_RESOURCES } from "@/lib/marketing/content";
import { generateMetadata } from "@/app/(marketing)/resources/[slug]/page";
import { config, proxy } from "@/proxy";

beforeEach(() => {
  refreshSupabaseAuthMock.mockReset();
  refreshSupabaseAuthMock.mockResolvedValue(new NextResponse(null, { status: 204 }));
});

describe("marketing resource page metadata", () => {
  it("returns metadata for a known resource slug", async () => {
    const resource = MARKETING_RESOURCES[0];

    await expect(
      generateMetadata({ params: Promise.resolve({ slug: resource.slug }) }),
    ).resolves.toMatchObject({
      title: resource.title,
      description: resource.summary,
    });
  });

  it("rejects an unknown slug as a 404 before the page stream starts", async () => {
    await expect(
      generateMetadata({ params: Promise.resolve({ slug: "no-such-resource" }) }),
    ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
});

describe("marketing resource request boundary", () => {
  it.each(["png", "svg", "jpg", "jpeg", "gif", "webp"])(
    "runs the proxy for an unknown resource slug ending in .%s",
    (extension) => {
      expect(
        unstable_doesMiddlewareMatch({
          config,
          nextConfig: {},
          url: `/resources/no-such-resource.${extension}`,
        }),
      ).toBe(true);

      expect(
        unstable_doesMiddlewareMatch({
          config,
          nextConfig: {},
          url: `/unrelated-image.${extension}`,
        }),
      ).toBe(false);
    },
  );

  it("rewrites an unknown resource slug to the branded 404 with a real 404 status", async () => {
    const response = await proxy(
      new NextRequest("https://factory.example/resources/no-such-resource"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://factory.example/_not-found",
    );
    expect(refreshSupabaseAuthMock).not.toHaveBeenCalled();
  });

  it("rewrites an image-suffixed unknown resource slug with a real 404 status", async () => {
    const response = await proxy(
      new NextRequest("https://factory.example/resources/no-such-resource.png"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://factory.example/_not-found",
    );
    expect(refreshSupabaseAuthMock).not.toHaveBeenCalled();
  });

  it.each([
    "opengraph-image",
    "twitter-image",
    "opengraph-image-no-such-resource",
    "twitter-image-no-such-resource",
    "opengraph-image-ABC123",
    "opengraph-image-aaaaaa",
    "twitter-image-000000",
  ])("does not exempt an arbitrary metadata-image-like slug: %s", async (slug) => {
    const response = await proxy(
      new NextRequest(`https://factory.example/resources/${slug}`),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://factory.example/_not-found",
    );
    expect(refreshSupabaseAuthMock).not.toHaveBeenCalled();
  });

  it("leaves every known resource slug on the normal authenticated request path", async () => {
    const resource = MARKETING_RESOURCES[0];
    const request = new NextRequest(`https://factory.example/resources/${resource.slug}`);

    await expect(proxy(request)).resolves.toMatchObject({ status: 204 });
    expect(refreshSupabaseAuthMock).toHaveBeenCalledOnce();
    expect(refreshSupabaseAuthMock).toHaveBeenCalledWith(request);
  });

  it.each(["opengraph-image-5fam9d", "twitter-image-5fam9d"])(
    "does not mistake the generated %s asset route for a resource slug",
    async (assetSlug) => {
      const request = new NextRequest(`https://factory.example/resources/${assetSlug}`);

      await expect(proxy(request)).resolves.toMatchObject({ status: 204 });
      expect(refreshSupabaseAuthMock).toHaveBeenCalledOnce();
      expect(refreshSupabaseAuthMock).toHaveBeenCalledWith(request);
    },
  );
});
