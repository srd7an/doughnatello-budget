export default {
  providers: [
    {
      // Convex Auth issues JWTs signed for this deployment.
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
