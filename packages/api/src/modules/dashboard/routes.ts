import { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { percentage } from "@dmark-hole/shared/utils";

export async function dashboardRoutes(server: FastifyInstance): Promise<void> {
  // GET /dashboard/overview - Main dashboard summary
  server.get("/overview", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request) => {
    const user = request.authUser!;
    const query = request.query as { period?: string; domainId?: string };
    const days = query.period === "7d" ? 7 : query.period === "90d" ? 90 : query.period === "1y" ? 365 : 30;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const domainFilter = query.domainId
      ? { organizationId: user.organizationId, id: query.domainId }
      : { organizationId: user.organizationId };

    const [domains, reports, alerts, summaries] = await Promise.all([
      prisma.domain.count({ where: { ...domainFilter, active: true } }),
      prisma.dmarcReport.count({
        where: { organizationId: user.organizationId, createdAt: { gte: since }, ...(query.domainId ? { domainId: query.domainId } : {}) },
      }),
      prisma.alert.count({
        where: { organizationId: user.organizationId, resolved: false, ...(query.domainId ? { domainId: query.domainId } : {}) },
      }),
      prisma.alert.count({
        where: { organizationId: user.organizationId, resolved: false, severity: "CRITICAL", ...(query.domainId ? { domainId: query.domainId } : {}) },
      }),
      prisma.dmarcDailySummary.findMany({
        where: { organizationId: user.organizationId, date: { gte: since }, ...(query.domainId ? { domainId: query.domainId } : {}) },
        orderBy: { date: "asc" },
      }),
    ]);

    const totalEmails = summaries.reduce((sum, s) => sum + s.totalEmails, 0);
    const totalDmarcPass = summaries.reduce((sum, s) => sum + s.dmarcPass, 0);
    const totalDmarcFail = summaries.reduce((sum, s) => sum + s.dmarcFail, 0);

    return {
      success: true,
      data: {
        totalDomains: domains,
        totalReports: reports,
        totalEmails,
        dmarcPassRate: percentage(totalDmarcPass, totalDmarcPass + totalDmarcFail),
        spfPassRate: percentage(
          summaries.reduce((sum, s) => sum + s.spfPass, 0),
          summaries.reduce((sum, s) => sum + s.spfPass + s.spfFail, 0),
        ),
        dkimPassRate: percentage(
          summaries.reduce((sum, s) => sum + s.dkimPass, 0),
          summaries.reduce((sum, s) => sum + s.dkimPass + s.dkimFail, 0),
        ),
        alertsOpen: alerts,
        alertsCritical: alertsCritical,
        healthTrend: summaries.map((s) => ({
          date: s.date.toISOString().split("T")[0],
          healthScore: s.healthScore || 0,
          dmarcPass: s.dmarcPass,
          dmarcFail: s.dmarcFail,
          total: s.totalEmails,
        })),
      },
    };
  });

  // GET /dashboard/timeseries - Time series data for charts
  server.get("/timeseries", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request) => {
    const user = request.authUser!;
    const query = request.query as { domainId?: string; period?: string };
    const days = query.period === "7d" ? 7 : query.period === "90d" ? 90 : query.period === "1y" ? 365 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const summaries = await prisma.dmarcDailySummary.findMany({
      where: {
        organizationId: user.organizationId,
        date: { gte: since },
        ...(query.domainId ? { domainId: query.domainId } : {}),
      },
      orderBy: { date: "asc" },
    });

    return {
      success: true,
      data: summaries.map((s) => ({
        date: s.date.toISOString().split("T")[0],
        total: s.totalEmails,
        spfPass: s.spfPass,
        spfFail: s.spfFail,
        dkimPass: s.dkimPass,
        dkimFail: s.dkimFail,
        dmarcPass: s.dmarcPass,
        dmarcFail: s.dmarcFail,
        uniqueIps: s.uniqueIps,
        forwarders: s.forwarders,
      })),
    };
  });

  // GET /dashboard/top-senders - Top email sources
  server.get("/top-senders", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request) => {
    const user = request.authUser!;
    const query = request.query as { domainId?: string; limit?: string };
    const limit = Math.min(parseInt(query.limit || "20", 10), 50);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const topSources = await prisma.dmarcRecord.groupBy({
      by: ["sourceIp", "sourceOrg", "sourceHost"],
      where: {
        report: {
          organizationId: user.organizationId,
          ...(query.domainId ? { domainId: query.domainId } : {}),
          createdAt: { gte: since },
        },
      },
      _sum: { count: true },
      _count: true,
      orderBy: { _sum: { count: "desc" } },
      take: limit,
    });

    // Get SPF/DKIM pass rates for these IPs
    const topIps = topSources.map((s) => s.sourceIp);
    const authStats = await prisma.dmarcRecord.groupBy({
      by: ["sourceIp", "spfResult", "dkimResult"],
      where: {
        sourceIp: { in: topIps },
        report: { organizationId: user.organizationId },
      },
      _count: true,
    });

    return {
      success: true,
      data: topSources.map((s) => ({
        sourceIp: s.sourceIp,
        sourceOrg: s.sourceOrg,
        sourceHost: s.sourceHost,
        totalCount: s._sum.count || 0,
        reportCount: s._count,
      })),
    };
  });

  // GET /dashboard/geo-distribution - Geographic distribution
  server.get("/geo-distribution", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request) => {
    const user = request.authUser!;
    const query = request.query as { domainId?: string };

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const geo = await prisma.dmarcRecord.groupBy({
      by: ["country"],
      where: {
        report: {
          organizationId: user.organizationId,
          ...(query.domainId ? { domainId: query.domainId } : {}),
          createdAt: { gte: since },
        },
        country: { not: null },
      },
      _sum: { count: true },
      _count: true,
      orderBy: { _sum: { count: "desc" } },
      take: 50,
    });

    return {
      success: true,
      data: geo.map((g) => ({
        country: g.country,
        count: g._sum.count || 0,
        reportCount: g._count,
      })),
    };
  });

  // GET /dashboard/domain-health - Health scores for all domains
  server.get("/domain-health", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request) => {
    const user = request.authUser!;

    const domains = await prisma.domain.findMany({
      where: { organizationId: user.organizationId, active: true },
      include: {
        dmarcSummary: {
          where: { date: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
          orderBy: { date: "asc" },
        },
      },
    });

    return {
      success: true,
      data: domains.map((d) => {
        const summaries = d.dmarcSummary;
        const latest = summaries[summaries.length - 1];
        const prev = summaries[summaries.length - 2];

        const totalPass = summaries.reduce((s, r) => s + r.dmarcPass, 0);
        const totalFail = summaries.reduce((s, r) => s + r.dmarcFail, 0);

        let trend: "up" | "down" | "stable" = "stable";
        if (latest && prev) {
          if (latest.healthScore && prev.healthScore) {
            if (latest.healthScore > prev.healthScore * 1.05) trend = "up";
            else if (latest.healthScore < prev.healthScore * 0.95) trend = "down";
          }
        }

        return {
          domain: d.domain,
          overallScore: latest?.healthScore || 0,
          spfAligned: latest?.spfAligned || 0,
          dkimAligned: latest?.dkimAligned || 0,
          dmarcPassRate: percentage(totalPass, totalPass + totalFail),
          totalEmails: summaries.reduce((s, r) => s + r.totalEmails, 0),
          trend,
          lastUpdated: latest?.date || null,
        };
      }),
    };
  });

  // GET /dashboard/asn-distribution - ASN distribution
  server.get("/asn-distribution", { preHandler: [authMiddleware, requireRole("ANALYST")] }, async (request) => {
    const user = request.authUser!;
    const query = request.query as { domainId?: string };

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const asn = await prisma.dmarcRecord.groupBy({
      by: ["asn", "asnOrg"],
      where: {
        report: {
          organizationId: user.organizationId,
          ...(query.domainId ? { domainId: query.domainId } : {}),
          createdAt: { gte: since },
        },
        asn: { not: null },
      },
      _sum: { count: true },
      _count: true,
      orderBy: { _sum: { count: "desc" } },
      take: 15,
    });

    return {
      success: true,
      data: asn.map((a) => ({
        asn: a.asn,
        asnOrg: a.asnOrg,
        count: a._sum.count || 0,
        reportCount: a._count,
      })),
    };
  });
}
