import type { AcUser } from "../core/types";

export function buildUnifiedCredentials(user: AcUser) {
  const omsCredentials = [
    {
      id: "oms-foundation",
      issuer: "OpenMatrix Skill",
      title: "OMS Foundation Learner",
      status: "issued",
      issuedAt: user.createdAt
    }
  ];

  const openCampusCredentials = user.ocid
    ? [
        {
          id: "oca-profile",
          issuer: "Open Campus",
          title: "OCID Linked Profile",
          status: "linked",
          issuedAt: user.updatedAt,
          subject: user.ocid
        }
      ]
    : [];

  return {
    credentials: [...omsCredentials, ...openCampusCredentials]
  };
}
