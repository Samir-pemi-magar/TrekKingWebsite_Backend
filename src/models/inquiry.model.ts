import { Prisma, Region } from "@prisma/client";
import { prisma } from "../config/prisma.js";

export interface InquiryCreateInput {
  name: string;
  email: string;
  regionInterest?: Region;
  message: string;
  trip?: { connect: { id: string } };
}

export function createInquiry(data: InquiryCreateInput) {
  return prisma.inquiry.create({ data });
}

export function listInquiries() {
  return prisma.inquiry.findMany({
    include: { trip: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export function getInquiryById(id: string) {
  return prisma.inquiry.findUnique({ where: { id } });
}

export function deleteInquiry(id: string) {
  return prisma.inquiry.delete({ where: { id } });
}
