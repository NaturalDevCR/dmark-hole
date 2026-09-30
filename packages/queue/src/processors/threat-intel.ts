import { prisma } from "@dmark-hole/db";

interface ThreatIntelJobData {
  domainId: string;
  ips: string[];
}

const ABUSEIPDB_API_KEY = process.env.ABUSEIPDB_API_KEY;

export async function processThreatIntel(data: ThreatIntelJobData): Promise<void> {
  const { domainId, ips } = data;

  if (ips.length === 0) return;

  for (const ip of ips.slice(0, 50)) { // Rate limit: max 50 IPs per run
    try {
      // Check AbuseIPDB
      if (ABUSEIPDB_API_KEY) {
        const response = await fetch(
          `https://api.abuseipdb.com/api/v2/check?ipAddress=${ip}&maxAgeInDays=90`,
          {
            headers: {
              Key: ABUSEIPDB_API_KEY,
              Accept: "application/json",
            },
          },
        );

        if (response.ok) {
          const data = await response.json() as {
            data: { abuseConfidenceScore: number; totalReports: number; isp: string; countryCode: string };
          };

          await prisma.threatIntel.upsert({
            where: {
              domainId_ip_source: { domainId, ip, source: "AbuseIPDB" },
            },
            create: {
              domainId,
              ip,
              source: "AbuseIPDB",
              listed: data.data.abuseConfidenceScore > 50,
              details: {
                score: data.data.abuseConfidenceScore,
                reports: data.data.totalReports,
                isp: data.data.isp,
                country: data.data.countryCode,
              },
            },
            update: {
              listed: data.data.abuseConfidenceScore > 50,
              details: {
                score: data.data.abuseConfidenceScore,
                reports: data.data.totalReports,
                isp: data.data.isp,
                country: data.data.countryCode,
              },
              checkedAt: new Date(),
            },
          });
        }
      }
    } catch (error) {
      console.error(`Threat intel check failed for IP ${ip}:`, error);
    }
  }
}
